use anchor_lang::prelude::*;

/// Messages mirror the copy deck's error list where one exists.
#[error_code]
pub enum Sl0tError {
    #[msg("This floor is guest list only.")]
    NotOnGuestList,
    #[msg("Stakes on this coin are closed.")]
    StakesClosed,
    #[msg("Your rematch expired.")]
    RematchExpired,
    #[msg("Rematch amount is fixed at 2x what you lost.")]
    RematchAmountFixed,
    #[msg("Max stake exceeded.")]
    MaxStakeExceeded,
    #[msg("This launch is already resolved.")]
    AlreadyResolved,
    #[msg("This launch can't be resolved yet.")]
    NotResolvable,
    #[msg("This launch isn't resolved yet.")]
    NotResolved,
    #[msg("SL0T is paused.")]
    Paused,
    #[msg("That isn't the pump.fun bonding curve for this mint.")]
    InvalidBondingCurve,
    #[msg("That isn't pump.fun's Global account.")]
    InvalidPumpGlobal,
    #[msg("This curve already graduated.")]
    CurveAlreadyComplete,
    #[msg("Only the coin's creator can register it.")]
    NotCurveCreator,
    #[msg("register_launch must run in the same transaction as pump.fun's create.")]
    CreateNotInTransaction,
    #[msg("You already staked the other side of this launch.")]
    SideLocked,
    #[msg("Amount must be more than zero.")]
    ZeroAmount,
    #[msg("Your rematch was already used.")]
    RematchUsed,
    #[msg("A rematch can't go on the launch you lost on.")]
    RematchOnSourceLaunch,
    #[msg("Rematch amount is above the max stake.")]
    RematchAboveMax,
    #[msg("This stake didn't win; use claim_loss.")]
    NotAWinner,
    #[msg("This stake didn't lose; use claim.")]
    NotALoser,
    #[msg("Not every stake on this launch has been claimed yet.")]
    NotAllSettled,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Only the admin can do that.")]
    Unauthorized,
    #[msg("Config value out of range.")]
    InvalidConfig,
}
