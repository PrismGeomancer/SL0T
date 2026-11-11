//! SL0T: a friends-only pump.fun launchpad.
//!
//! Every launch opens a two-sided pool (HIT / MISS). HIT means the pump.fun
//! bonding curve completed (graduated). MISS means it was still on the curve
//! when the window closed. The program reads the curve itself in `resolve`,
//! so whoever calls it (the keeper, or anyone) can't change the outcome.
//! Winners split the losing side pro rata, 0% house cut. A lost stake unlocks
//! one rematch at exactly 2x. Nobody, including admin and keeper, can move a
//! vault's lamports except winners claiming and the final dust sweep to the
//! launch's creator.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked;
use anchor_lang::system_program::{transfer, Transfer};

pub mod errors;
pub mod events;
pub mod math;
pub mod pump;
pub mod state;

use errors::Sl0tError;
use events::*;
use state::*;

declare_id!("5kgnp4QxSM3VEJgrqKeDL4W86Gh2iZNkGAwBXNuMP9Hq");

/// pump.fun on mainnet and devnet: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P (set in Config).

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitConfigParams {
    pub keeper: Pubkey,
    pub pump_program: Pubkey,
    pub launch_fee_lamports: u64,
    pub max_stake_lamports: u64,
    pub window_secs: i64,
    pub stake_close_secs: i64,
    pub rematch_secs: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateConfigParams {
    pub admin: Option<Pubkey>,
    pub keeper: Option<Pubkey>,
    pub pump_program: Option<Pubkey>,
    pub launch_fee_lamports: Option<u64>,
    pub max_stake_lamports: Option<u64>,
    pub window_secs: Option<i64>,
    pub stake_close_secs: Option<i64>,
    pub rematch_secs: Option<i64>,
    pub paused: Option<bool>,
}

fn validate_config(c: &Config) -> Result<()> {
    require!(c.launch_fee_lamports > 0, Sl0tError::InvalidConfig);
    // A launch fee must always be rematchable at 2x.
    require!(
        c.launch_fee_lamports
            .checked_mul(2)
            .ok_or(Sl0tError::MathOverflow)?
            <= c.max_stake_lamports,
        Sl0tError::InvalidConfig
    );
    require!(c.window_secs > 0, Sl0tError::InvalidConfig);
    require!(
        c.stake_close_secs > 0 && c.stake_close_secs <= c.window_secs,
        Sl0tError::InvalidConfig
    );
    require!(c.rematch_secs > 0, Sl0tError::InvalidConfig);
    Ok(())
}

fn emit_config(c: &Config) {
    emit!(ConfigUpdated {
        admin: c.admin,
        keeper: c.keeper,
        pump_program: c.pump_program,
        launch_fee_lamports: c.launch_fee_lamports,
        max_stake_lamports: c.max_stake_lamports,
        window_secs: c.window_secs,
        stake_close_secs: c.stake_close_secs,
        rematch_secs: c.rematch_secs,
        paused: c.paused,
    });
}

/// A wallet is on the guest list when its Friend PDA exists and is ours.
fn require_friend(friend: &AccountInfo) -> Result<()> {
    require!(
        friend.owner == &crate::ID && !friend.data_is_empty(),
        Sl0tError::NotOnGuestList
    );
    Ok(())
}

fn pay_into_vault<'info>(
    system_program: &Program<'info, System>,
    from: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    transfer(
        CpiContext::new(
            system_program.to_account_info(),
            Transfer { from, to: vault },
        ),
        lamports,
    )
}

fn pay_out_of_vault<'info>(
    system_program: &Program<'info, System>,
    vault: AccountInfo<'info>,
    to: AccountInfo<'info>,
    launch_key: &Pubkey,
    vault_bump: u8,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[VAULT_SEED, launch_key.as_ref(), &[vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            Transfer { from: vault, to },
            &[seeds],
        ),
        lamports,
    )
}

/// Shared by `stake` and `stake_rematch`.
fn add_to_stake(
    launch: &mut Account<Launch>,
    stake: &mut Account<Stake>,
    owner: Pubkey,
    side: Side,
    amount: u64,
    max_stake: u64,
    is_rematch: bool,
    stake_bump: u8,
) -> Result<()> {
    require!(amount > 0, Sl0tError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(launch.state == LaunchState::Open, Sl0tError::AlreadyResolved);
    require!(now < launch.stake_close_at, Sl0tError::StakesClosed);

    let is_new = stake.owner == Pubkey::default();
    if is_new {
        stake.owner = owner;
        stake.launch = launch.key();
        stake.side = side;
        stake.amount = 0;
        stake.is_rematch = false;
        stake.claimed = false;
        stake.bump = stake_bump;
        launch.stake_count = launch
            .stake_count
            .checked_add(1)
            .ok_or(Sl0tError::MathOverflow)?;
    } else {
        require!(stake.side == side, Sl0tError::SideLocked);
    }

    let new_amount = stake
        .amount
        .checked_add(amount)
        .ok_or(Sl0tError::MathOverflow)?;
    require!(new_amount <= max_stake, Sl0tError::MaxStakeExceeded);
    stake.amount = new_amount;
    stake.is_rematch = stake.is_rematch || is_rematch;

    match side {
        Side::Hit => {
            launch.hit_total = launch
                .hit_total
                .checked_add(amount)
                .ok_or(Sl0tError::MathOverflow)?
        }
        Side::Miss => {
            launch.miss_total = launch
                .miss_total
                .checked_add(amount)
                .ok_or(Sl0tError::MathOverflow)?
        }
    }
    Ok(())
}

#[program]
pub mod sl0t {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.keeper = params.keeper;
        c.pump_program = params.pump_program;
        c.launch_fee_lamports = params.launch_fee_lamports;
        c.max_stake_lamports = params.max_stake_lamports;
        c.window_secs = params.window_secs;
        c.stake_close_secs = params.stake_close_secs;
        c.rematch_secs = params.rematch_secs;
        c.paused = false;
        c.bump = ctx.bumps.config;
        validate_config(c)?;
        emit_config(c);
        Ok(())
    }

    /// Window and stake-close are copied into each Launch at open, so these
    /// changes only ever apply to launches opened afterwards.
    pub fn update_config(ctx: Context<AdminConfig>, params: UpdateConfigParams) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(v) = params.admin {
            c.admin = v;
        }
        if let Some(v) = params.keeper {
            c.keeper = v;
        }
        if let Some(v) = params.pump_program {
            c.pump_program = v;
        }
        if let Some(v) = params.launch_fee_lamports {
            c.launch_fee_lamports = v;
        }
        if let Some(v) = params.max_stake_lamports {
            c.max_stake_lamports = v;
        }
        if let Some(v) = params.window_secs {
            c.window_secs = v;
        }
        if let Some(v) = params.stake_close_secs {
            c.stake_close_secs = v;
        }
        if let Some(v) = params.rematch_secs {
            c.rematch_secs = v;
        }
        if let Some(v) = params.paused {
            c.paused = v;
        }
        validate_config(c)?;
        emit_config(c);
        Ok(())
    }

    pub fn add_friend(ctx: Context<AddFriend>, wallet: Pubkey) -> Result<()> {
        let f = &mut ctx.accounts.friend;
        f.wallet = wallet;
        f.added_at = Clock::get()?.unix_timestamp;
        f.bump = ctx.bumps.friend;
        emit!(FriendAdded { wallet });
        Ok(())
    }

    pub fn remove_friend(ctx: Context<RemoveFriend>, wallet: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.friend.wallet, wallet, Sl0tError::NotOnGuestList);
        emit!(FriendRemoved { wallet });
        Ok(())
    }

    /// Must sit in the same transaction as pump.fun's `create_v2` (or legacy
    /// `create`) for the same mint.
    pub fn register_launch(ctx: Context<RegisterLaunch>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, Sl0tError::Paused);
        require_friend(&ctx.accounts.friend.to_account_info())?;

        let mint = ctx.accounts.mint.key();
        let creator = ctx.accounts.creator.key();
        let pump_program = config.pump_program;

        // 1. The curve is pump.fun's PDA for this mint, owned by pump.fun.
        let (expected_curve, _) =
            Pubkey::find_program_address(&[pump::BONDING_CURVE_SEED, mint.as_ref()], &pump_program);
        let curve_info = ctx.accounts.bonding_curve.to_account_info();
        require_keys_eq!(curve_info.key(), expected_curve, Sl0tError::InvalidBondingCurve);
        require_keys_eq!(*curve_info.owner, pump_program, Sl0tError::InvalidBondingCurve);
        let curve = pump::parse_curve(&curve_info.try_borrow_data()?[..])?;
        require!(!curve.complete, Sl0tError::CurveAlreadyComplete);
        require_keys_eq!(curve.creator, creator, Sl0tError::NotCurveCreator);

        // 2. pump.fun's create for this mint is in this very transaction, so
        //    nobody can register an old, nearly-full curve.
        let ix_sysvar = ctx.accounts.instructions.to_account_info();
        let mut found = false;
        let mut i: usize = 0;
        while let Ok(ix) = load_instruction_at_checked(i, &ix_sysvar) {
            if ix.program_id == pump_program
                && ix.data.len() >= 8
                && (ix.data[..8] == pump::CREATE_V2_DISCRIMINATOR
                    || ix.data[..8] == pump::CREATE_DISCRIMINATOR)
                && ix.accounts.first().map(|a| a.pubkey) == Some(mint)
            {
                found = true;
                break;
            }
            i += 1;
        }
        require!(found, Sl0tError::CreateNotInTransaction);

        // 3. Open the pool. The creator also pre-funds the vault's rent so the
        //    vault can never drop below rent-exemption while paying out.
        let now = Clock::get()?.unix_timestamp;
        let fee = config.launch_fee_lamports;
        let rent = Rent::get()?.minimum_balance(0);
        pay_into_vault(
            &ctx.accounts.system_program,
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            fee.checked_add(rent).ok_or(Sl0tError::MathOverflow)?,
        )?;

        let launch_key = ctx.accounts.launch.key();
        let launch = &mut ctx.accounts.launch;
        launch.creator = creator;
        launch.mint = mint;
        launch.bonding_curve = expected_curve;
        launch.pump_program = pump_program;
        launch.opened_at = now;
        launch.deadline = now.checked_add(config.window_secs).ok_or(Sl0tError::MathOverflow)?;
        launch.stake_close_at = now
            .checked_add(config.stake_close_secs)
            .ok_or(Sl0tError::MathOverflow)?;
        launch.resolved_at = 0;
        launch.state = LaunchState::Open;
        launch.hit_total = fee;
        launch.miss_total = 0;
        launch.stake_count = 1;
        launch.settled_count = 0;
        launch.evidence_slot = 0;
        launch.evidence_pct_bps = 0;
        launch.evidence_complete = false;
        launch.vault_bump = ctx.bumps.vault;
        launch.bump = ctx.bumps.launch;

        let stake = &mut ctx.accounts.creator_stake;
        stake.owner = creator;
        stake.launch = launch_key;
        stake.side = Side::Hit;
        stake.amount = fee;
        stake.is_rematch = false;
        stake.claimed = false;
        stake.bump = ctx.bumps.creator_stake;

        emit!(LaunchRegistered {
            launch: launch_key,
            mint,
            creator,
            fee,
            opened_at: launch.opened_at,
            deadline: launch.deadline,
            stake_close_at: launch.stake_close_at,
        });
        emit!(Staked {
            launch: launch_key,
            mint,
            owner: creator,
            side: Side::Hit,
            amount: fee,
            is_rematch: false,
            hit_total: launch.hit_total,
            miss_total: launch.miss_total,
        });
        Ok(())
    }

    pub fn stake(ctx: Context<PlaceStake>, side: Side, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, Sl0tError::Paused);
        require_friend(&ctx.accounts.friend.to_account_info())?;
        let owner = ctx.accounts.owner.key();
        let max = ctx.accounts.config.max_stake_lamports;
        let bump = ctx.bumps.stake;
        add_to_stake(
            &mut ctx.accounts.launch,
            &mut ctx.accounts.stake,
            owner,
            side,
            amount,
            max,
            false,
            bump,
        )?;
        pay_into_vault(
            &ctx.accounts.system_program,
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            amount,
        )?;
        let l = &ctx.accounts.launch;
        emit!(Staked {
            launch: l.key(),
            mint: l.mint,
            owner,
            side,
            amount,
            is_rematch: false,
            hit_total: l.hit_total,
            miss_total: l.miss_total,
        });
        Ok(())
    }

    /// `expected_amount` is what the wallet shows; it must equal exactly 2x
    /// the lost amount.
    pub fn stake_rematch(ctx: Context<StakeRematch>, side: Side, expected_amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, Sl0tError::Paused);
        require_friend(&ctx.accounts.friend.to_account_info())?;
        let now = Clock::get()?.unix_timestamp;
        let rematch = &mut ctx.accounts.rematch;
        require!(!rematch.used, Sl0tError::RematchUsed);
        require!(now < rematch.expires_at, Sl0tError::RematchExpired);
        require_keys_neq!(
            rematch.source_launch,
            ctx.accounts.launch.key(),
            Sl0tError::RematchOnSourceLaunch
        );
        let amount = rematch.required_amount().ok_or(Sl0tError::MathOverflow)?;
        require!(expected_amount == amount, Sl0tError::RematchAmountFixed);
        let max = ctx.accounts.config.max_stake_lamports;
        require!(amount <= max, Sl0tError::RematchAboveMax);
        rematch.used = true;

        let owner = ctx.accounts.owner.key();
        let bump = ctx.bumps.stake;
        add_to_stake(
            &mut ctx.accounts.launch,
            &mut ctx.accounts.stake,
            owner,
            side,
            amount,
            max,
            true,
            bump,
        )?;
        pay_into_vault(
            &ctx.accounts.system_program,
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            amount,
        )?;
        let l = &ctx.accounts.launch;
        emit!(Staked {
            launch: l.key(),
            mint: l.mint,
            owner,
            side,
            amount,
            is_rematch: true,
            hit_total: l.hit_total,
            miss_total: l.miss_total,
        });
        Ok(())
    }

    /// Permissionless. The outcome comes from the pump.fun curve, not from the
    /// caller: complete = HIT (any time), not complete after the deadline =
    /// MISS, one side empty = VOID.
    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        let launch = &mut ctx.accounts.launch;
        require!(launch.state == LaunchState::Open, Sl0tError::AlreadyResolved);

        let pump_program = launch.pump_program;
        let curve_info = ctx.accounts.bonding_curve.to_account_info();
        require_keys_eq!(curve_info.key(), launch.bonding_curve, Sl0tError::InvalidBondingCurve);
        require_keys_eq!(*curve_info.owner, pump_program, Sl0tError::InvalidBondingCurve);
        let curve = pump::parse_curve(&curve_info.try_borrow_data()?[..])?;

        let global_info = ctx.accounts.pump_global.to_account_info();
        let (expected_global, _) = Pubkey::find_program_address(&[pump::GLOBAL_SEED], &pump_program);
        require_keys_eq!(global_info.key(), expected_global, Sl0tError::InvalidPumpGlobal);
        require_keys_eq!(*global_info.owner, pump_program, Sl0tError::InvalidPumpGlobal);
        let initial = pump::parse_global_initial_real_tokens(&global_info.try_borrow_data()?[..])?;

        let clock = Clock::get()?;
        let outcome = if curve.complete {
            LaunchState::Hit
        } else if clock.unix_timestamp >= launch.deadline {
            LaunchState::Miss
        } else {
            return err!(Sl0tError::NotResolvable);
        };
        let state = if launch.hit_total == 0 || launch.miss_total == 0 {
            LaunchState::Void
        } else {
            outcome
        };

        launch.state = state;
        launch.resolved_at = clock.unix_timestamp;
        launch.evidence_slot = clock.slot;
        launch.evidence_pct_bps = pump::progress_bps(&curve, initial);
        launch.evidence_complete = curve.complete;

        emit!(Resolved {
            launch: launch.key(),
            mint: launch.mint,
            state,
            hit_total: launch.hit_total,
            miss_total: launch.miss_total,
            evidence_slot: launch.evidence_slot,
            evidence_pct_bps: launch.evidence_pct_bps,
            curve_complete: curve.complete,
            resolver: ctx.accounts.resolver.key(),
        });
        Ok(())
    }

    /// Winners and VOID refunds. Closes the Stake (rent back to the owner).
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let launch = &ctx.accounts.launch;
        require!(launch.is_resolved(), Sl0tError::NotResolved);
        let stake = &ctx.accounts.stake;

        let payout = match launch.winning_side() {
            None => stake.amount, // VOID: refund
            Some(winner) => {
                require!(stake.side == winner, Sl0tError::NotAWinner);
                let (win_total, lose_total) = match winner {
                    Side::Hit => (launch.hit_total, launch.miss_total),
                    Side::Miss => (launch.miss_total, launch.hit_total),
                };
                math::winner_payout(stake.amount, win_total, lose_total)?
            }
        };

        let launch_key = launch.key();
        pay_out_of_vault(
            &ctx.accounts.system_program,
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            &launch_key,
            launch.vault_bump,
            payout,
        )?;

        let side = stake.side;
        let amount = stake.amount;
        ctx.accounts.stake.claimed = true;
        let launch = &mut ctx.accounts.launch;
        launch.settled_count = launch
            .settled_count
            .checked_add(1)
            .ok_or(Sl0tError::MathOverflow)?;

        emit!(Claimed {
            launch: launch_key,
            mint: launch.mint,
            owner: ctx.accounts.owner.key(),
            side,
            amount,
            payout,
            state: launch.state,
        });
        Ok(())
    }

    /// Losers acknowledge the loss: nothing is paid, the Stake closes (rent
    /// back) and a rematch at 2x opens (or is overwritten).
    pub fn claim_loss(ctx: Context<ClaimLoss>) -> Result<()> {
        let launch = &ctx.accounts.launch;
        require!(launch.is_resolved(), Sl0tError::NotResolved);
        let winner = launch.winning_side().ok_or(Sl0tError::NotALoser)?;
        let stake = &ctx.accounts.stake;
        require!(stake.side != winner, Sl0tError::NotALoser);

        let config = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let amount_lost = math::capped_amount_lost(stake.amount, config.max_stake_lamports);
        let expires_at = now
            .checked_add(config.rematch_secs)
            .ok_or(Sl0tError::MathOverflow)?;
        let launch_key = launch.key();

        let rematch = &mut ctx.accounts.rematch;
        rematch.owner = ctx.accounts.owner.key();
        rematch.amount_lost = amount_lost;
        rematch.source_launch = launch_key;
        rematch.expires_at = expires_at;
        rematch.used = false;
        rematch.bump = ctx.bumps.rematch;

        let side = stake.side;
        let amount = stake.amount;
        ctx.accounts.stake.claimed = true;
        let launch = &mut ctx.accounts.launch;
        launch.settled_count = launch
            .settled_count
            .checked_add(1)
            .ok_or(Sl0tError::MathOverflow)?;

        emit!(LossSettled {
            launch: launch_key,
            mint: launch.mint,
            owner: ctx.accounts.owner.key(),
            side,
            amount,
            rematch_amount: amount_lost.checked_mul(2).ok_or(Sl0tError::MathOverflow)?,
            rematch_expires_at: expires_at,
        });
        Ok(())
    }

    /// Admin only, once every stake is settled: whatever is left in the vault
    /// (rounding dust + the vault's rent deposit) goes to the launch creator,
    /// who paid that rent. The vault account disappears.
    pub fn sweep_dust(ctx: Context<SweepDust>) -> Result<()> {
        let launch = &ctx.accounts.launch;
        require!(launch.is_resolved(), Sl0tError::NotResolved);
        require!(launch.settled_count == launch.stake_count, Sl0tError::NotAllSettled);
        let lamports = ctx.accounts.vault.to_account_info().lamports();
        let launch_key = launch.key();
        pay_out_of_vault(
            &ctx.accounts.system_program,
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            &launch_key,
            launch.vault_bump,
            lamports,
        )?;
        emit!(DustSwept {
            launch: launch_key,
            mint: launch.mint,
            to: launch.creator,
            lamports,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ Sl0tError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct AddFriend<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ Sl0tError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Friend::INIT_SPACE, seeds = [FRIEND_SEED, wallet.as_ref()], bump)]
    pub friend: Account<'info, Friend>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RemoveFriend<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ Sl0tError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, close = admin, seeds = [FRIEND_SEED, wallet.as_ref()], bump = friend.bump)]
    pub friend: Account<'info, Friend>,
}

#[derive(Accounts)]
pub struct RegisterLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: guest-list PDA; existence checked in the handler so a missing
    /// account maps to NotOnGuestList.
    #[account(seeds = [FRIEND_SEED, creator.key().as_ref()], bump)]
    pub friend: UncheckedAccount<'info>,
    /// CHECK: the pump.fun mint created earlier in this transaction.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: verified in the handler (PDA, owner, layout, not complete).
    pub bonding_curve: UncheckedAccount<'info>,
    #[account(init, payer = creator, space = 8 + Launch::INIT_SPACE, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(init, payer = creator, space = 8 + Stake::INIT_SPACE, seeds = [STAKE_SEED, launch.key().as_ref(), creator.key().as_ref()], bump)]
    pub creator_stake: Account<'info, Stake>,
    /// CHECK: the instructions sysvar.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: guest-list PDA, checked in the handler.
    #[account(seeds = [FRIEND_SEED, owner.key().as_ref()], bump)]
    pub friend: UncheckedAccount<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + Stake::INIT_SPACE, seeds = [STAKE_SEED, launch.key().as_ref(), owner.key().as_ref()], bump)]
    pub stake: Account<'info, Stake>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeRematch<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: guest-list PDA, checked in the handler.
    #[account(seeds = [FRIEND_SEED, owner.key().as_ref()], bump)]
    pub friend: UncheckedAccount<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + Stake::INIT_SPACE, seeds = [STAKE_SEED, launch.key().as_ref(), owner.key().as_ref()], bump)]
    pub stake: Account<'info, Stake>,
    #[account(mut, seeds = [REMATCH_SEED, owner.key().as_ref()], bump = rematch.bump, has_one = owner)]
    pub rematch: Account<'info, Rematch>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    /// Anyone. Pays the transaction fee, nothing else.
    pub resolver: Signer<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    /// CHECK: must equal launch.bonding_curve and be owned by pump.fun.
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: pump.fun's Global PDA, verified in the handler.
    pub pump_global: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, close = owner, seeds = [STAKE_SEED, launch.key().as_ref(), owner.key().as_ref()], bump = stake.bump, has_one = owner, has_one = launch)]
    pub stake: Account<'info, Stake>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimLoss<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, close = owner, seeds = [STAKE_SEED, launch.key().as_ref(), owner.key().as_ref()], bump = stake.bump, has_one = owner, has_one = launch)]
    pub stake: Account<'info, Stake>,
    #[account(init_if_needed, payer = owner, space = 8 + Rematch::INIT_SPACE, seeds = [REMATCH_SEED, owner.key().as_ref()], bump)]
    pub rematch: Account<'info, Rematch>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepDust<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ Sl0tError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [LAUNCH_SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [VAULT_SEED, launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: receives the dust; must be the launch creator.
    #[account(mut, address = launch.creator)]
    pub creator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
