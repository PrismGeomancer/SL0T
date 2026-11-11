//! TEST ONLY. A stand-in for pump.fun with byte-identical BondingCurve and
//! Global prefixes and the same `create_v2` instruction discriminator
//! (Anchor derives both from the names). Lets the sl0t tests run on a local
//! bank. Never deploy this to a public cluster.

use anchor_lang::prelude::*;

declare_id!("92DA2NnMxr5MvNWDwGFU3YQySJy3GbbeVmxHwkJv9cHa");

pub const INITIAL_REAL_TOKEN_RESERVES: u64 = 793_100_000_000_000;

#[program]
pub mod mock_pump {
    use super::*;

    pub fn init_global(ctx: Context<InitGlobal>) -> Result<()> {
        let g = &mut ctx.accounts.global;
        g.initialized = true;
        g.authority = ctx.accounts.payer.key();
        g.fee_recipient = ctx.accounts.payer.key();
        g.initial_virtual_token_reserves = 1_073_000_000_000_000;
        g.initial_virtual_sol_reserves = 30_000_000_000;
        g.initial_real_token_reserves = INITIAL_REAL_TOKEN_RESERVES;
        g.token_total_supply = 1_000_000_000_000_000;
        Ok(())
    }

    /// Same name (so same discriminator) and same first account (mint) as
    /// pump.fun's create_v2. Args are accepted and ignored.
    pub fn create_v2(
        ctx: Context<CreateV2>,
        _name: String,
        _symbol: String,
        _uri: String,
        creator: Pubkey,
    ) -> Result<()> {
        let c = &mut ctx.accounts.bonding_curve;
        c.virtual_token_reserves = 1_073_000_000_000_000;
        c.virtual_quote_reserves = 30_000_000_000;
        c.real_token_reserves = INITIAL_REAL_TOKEN_RESERVES;
        c.real_quote_reserves = 0;
        c.token_total_supply = 1_000_000_000_000_000;
        c.complete = false;
        c.creator = creator;
        Ok(())
    }

    /// Test lever: move the curve.
    pub fn set_curve(ctx: Context<SetCurve>, real_token_reserves: u64, complete: bool) -> Result<()> {
        let c = &mut ctx.accounts.bonding_curve;
        c.real_token_reserves = real_token_reserves;
        c.complete = complete;
        Ok(())
    }
}

#[account]
pub struct Global {
    pub initialized: bool,
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub initial_virtual_token_reserves: u64,
    pub initial_virtual_sol_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub token_total_supply: u64,
}

#[account]
pub struct BondingCurve {
    pub virtual_token_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub real_token_reserves: u64,
    pub real_quote_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub creator: Pubkey,
}

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + 1 + 32 + 32 + 8 * 4, seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateV2<'info> {
    /// CHECK: any fresh key; signs like pump.fun's mint keypair does.
    pub mint: Signer<'info>,
    #[account(init, payer = user, space = 8 + 8 * 5 + 1 + 32, seeds = [b"bonding-curve", mint.key().as_ref()], bump)]
    pub bonding_curve: Account<'info, BondingCurve>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCurve<'info> {
    pub anyone: Signer<'info>,
    #[account(mut)]
    pub bonding_curve: Account<'info, BondingCurve>,
}
