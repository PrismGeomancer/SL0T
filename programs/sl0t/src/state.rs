use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const FRIEND_SEED: &[u8] = b"friend";
pub const LAUNCH_SEED: &[u8] = b"launch";
pub const VAULT_SEED: &[u8] = b"vault";
pub const STAKE_SEED: &[u8] = b"stake";
pub const REMATCH_SEED: &[u8] = b"rematch";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Informational: resolve is permissionless, this is who usually calls it.
    pub keeper: Pubkey,
    pub pump_program: Pubkey,
    pub launch_fee_lamports: u64,
    pub max_stake_lamports: u64,
    pub window_secs: i64,
    pub stake_close_secs: i64,
    pub rematch_secs: i64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Friend {
    pub wallet: Pubkey,
    pub added_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LaunchState {
    Open,
    Hit,
    Miss,
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Side {
    Hit,
    Miss,
}

/// Field order matters: the keeper filters on `state` at byte offset 168
/// (8 discriminator + 4 * 32 pubkeys + 4 * 8 i64).
#[account]
#[derive(InitSpace)]
pub struct Launch {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    /// Copied from config at open, so a later pump.fun migration can't strand it.
    pub pump_program: Pubkey,
    pub opened_at: i64,
    pub deadline: i64,
    pub stake_close_at: i64,
    pub resolved_at: i64,
    pub state: LaunchState,
    pub hit_total: u64,
    pub miss_total: u64,
    pub stake_count: u32,
    pub settled_count: u32,
    pub evidence_slot: u64,
    pub evidence_pct_bps: u16,
    pub evidence_complete: bool,
    pub vault_bump: u8,
    pub bump: u8,
}

impl Launch {
    pub const STATE_OFFSET: usize = 8 + 32 * 4 + 8 * 4;

    pub fn is_resolved(&self) -> bool {
        self.state != LaunchState::Open
    }

    pub fn winning_side(&self) -> Option<Side> {
        match self.state {
            LaunchState::Hit => Some(Side::Hit),
            LaunchState::Miss => Some(Side::Miss),
            _ => None,
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct Stake {
    pub owner: Pubkey,
    pub launch: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub is_rematch: bool,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Rematch {
    pub owner: Pubkey,
    pub amount_lost: u64,
    pub source_launch: Pubkey,
    pub expires_at: i64,
    pub used: bool,
    pub bump: u8,
}

impl Rematch {
    pub fn required_amount(&self) -> Option<u64> {
        self.amount_lost.checked_mul(2)
    }
}
