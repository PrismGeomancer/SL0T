//! Pool math. All checked, all u128 in the middle.

use anchor_lang::prelude::*;

use crate::errors::Sl0tError;

/// What a winning stake receives: its own amount back plus its pro-rata share
/// of the losing side, rounded down. Rounding dust stays in the vault.
pub fn winner_payout(amount: u64, winning_total: u64, losing_total: u64) -> Result<u64> {
    require!(winning_total > 0, Sl0tError::MathOverflow);
    require!(amount <= winning_total, Sl0tError::MathOverflow);
    let share = (amount as u128)
        .checked_mul(losing_total as u128)
        .ok_or(Sl0tError::MathOverflow)?
        .checked_div(winning_total as u128)
        .ok_or(Sl0tError::MathOverflow)?;
    let total = (amount as u128)
        .checked_add(share)
        .ok_or(Sl0tError::MathOverflow)?;
    u64::try_from(total).map_err(|_| error!(Sl0tError::MathOverflow))
}

/// The amount a loss unlocks as a rematch "amount_lost", capped so that the
/// 2x rematch always fits under the max stake (chained rematches stop growing
/// at the cap).
pub fn capped_amount_lost(amount: u64, max_stake: u64) -> u64 {
    amount.min(max_stake / 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_deck_worked_example() {
        // $DUCK: 0.6 SOL on HIT, 0.4 SOL on MISS. Ana has 0.2 on HIT.
        let lamports = 1_000_000_000u64;
        let p = winner_payout(lamports / 5, lamports * 6 / 10, lamports * 4 / 10).unwrap();
        assert_eq!(p, 333_333_333);
    }

    #[test]
    fn rounding_down_never_overpays() {
        let (a, b, c) = (1u64, 2u64, 3u64);
        let w = a + b + c;
        let losing = 100u64;
        let paid: u64 = [a, b, c]
            .iter()
            .map(|x| winner_payout(*x, w, losing).unwrap())
            .sum();
        assert!(paid <= w + losing);
        assert_eq!(w + losing - paid, 1); // 16 + 33 + 50 = 99, 1 lamport dust
    }

    #[test]
    fn huge_values_do_not_overflow() {
        let p = winner_payout(u64::MAX / 2, u64::MAX / 2, u64::MAX / 2).unwrap();
        assert_eq!(p, (u64::MAX / 2) * 2);
        assert!(winner_payout(u64::MAX, u64::MAX, u64::MAX).is_err());
    }

    #[test]
    fn rematch_cap() {
        assert_eq!(capped_amount_lost(100_000_000, 1_000_000_000), 100_000_000);
        assert_eq!(capped_amount_lost(800_000_000, 1_000_000_000), 500_000_000);
    }
}
