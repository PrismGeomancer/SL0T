use anchor_lang::prelude::*;

use crate::state::{LaunchState, Side};

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub pump_program: Pubkey,
    pub launch_fee_lamports: u64,
    pub max_stake_lamports: u64,
    pub window_secs: i64,
    pub stake_close_secs: i64,
    pub rematch_secs: i64,
    pub paused: bool,
}

#[event]
pub struct FriendAdded {
    pub wallet: Pubkey,
}

#[event]
pub struct FriendRemoved {
    pub wallet: Pubkey,
}

#[event]
pub struct LaunchRegistered {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub fee: u64,
    pub opened_at: i64,
    pub deadline: i64,
    pub stake_close_at: i64,
}

#[event]
pub struct Staked {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub is_rematch: bool,
    pub hit_total: u64,
    pub miss_total: u64,
}

#[event]
pub struct Resolved {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub state: LaunchState,
    pub hit_total: u64,
    pub miss_total: u64,
    pub evidence_slot: u64,
    pub evidence_pct_bps: u16,
    pub curve_complete: bool,
    pub resolver: Pubkey,
}

#[event]
pub struct Claimed {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub payout: u64,
    pub state: LaunchState,
}

#[event]
pub struct LossSettled {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub rematch_amount: u64,
    pub rematch_expires_at: i64,
}

#[event]
pub struct DustSwept {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub to: Pubkey,
    pub lamports: u64,
}
