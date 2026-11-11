//! Minimal, read-only view of pump.fun accounts.
//!
//! Offsets come from the pump.fun IDL shipped in `@pump-fun/pump-sdk` 4.3.1:
//!
//! BondingCurve (Anchor account, 8-byte discriminator first)
//!   8   virtual_token_reserves  u64
//!   16  virtual_quote_reserves  u64
//!   24  real_token_reserves     u64
//!   32  real_quote_reserves     u64
//!   40  token_total_supply      u64
//!   48  complete                bool
//!   49  creator                 Pubkey
//!
//! Global
//!   8   initialized                    bool
//!   9   authority                      Pubkey
//!   41  fee_recipient                  Pubkey
//!   73  initial_virtual_token_reserves u64
//!   81  initial_virtual_sol_reserves   u64
//!   89  initial_real_token_reserves    u64
//!
//! Older curves are shorter (115..166 bytes) but every field we read sits in
//! the first 81 bytes, which every live curve has.

use anchor_lang::prelude::*;

use crate::errors::Sl0tError;

pub const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
pub const GLOBAL_DISCRIMINATOR: [u8; 8] = [167, 232, 232, 177, 200, 108, 114, 127];
pub const CREATE_DISCRIMINATOR: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];
pub const CREATE_V2_DISCRIMINATOR: [u8; 8] = [214, 144, 76, 236, 95, 139, 49, 180];

pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const GLOBAL_SEED: &[u8] = b"global";

const REAL_TOKEN_RESERVES_OFFSET: usize = 24;
const COMPLETE_OFFSET: usize = 48;
const CREATOR_OFFSET: usize = 49;
const CURVE_MIN_LEN: usize = CREATOR_OFFSET + 32;

const INITIAL_REAL_TOKEN_RESERVES_OFFSET: usize = 89;
const GLOBAL_MIN_LEN: usize = INITIAL_REAL_TOKEN_RESERVES_OFFSET + 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CurveView {
    pub real_token_reserves: u64,
    pub complete: bool,
    pub creator: Pubkey,
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(buf)
}

/// Parse the bytes of a pump.fun bonding curve account.
pub fn parse_curve(data: &[u8]) -> Result<CurveView> {
    require!(data.len() >= CURVE_MIN_LEN, Sl0tError::InvalidBondingCurve);
    require!(
        data[..8] == BONDING_CURVE_DISCRIMINATOR,
        Sl0tError::InvalidBondingCurve
    );
    let complete = match data[COMPLETE_OFFSET] {
        0 => false,
        1 => true,
        _ => return err!(Sl0tError::InvalidBondingCurve),
    };
    let mut creator = [0u8; 32];
    creator.copy_from_slice(&data[CREATOR_OFFSET..CREATOR_OFFSET + 32]);
    Ok(CurveView {
        real_token_reserves: read_u64(data, REAL_TOKEN_RESERVES_OFFSET),
        complete,
        creator: Pubkey::new_from_array(creator),
    })
}

/// Parse `initial_real_token_reserves` from pump.fun's Global account.
pub fn parse_global_initial_real_tokens(data: &[u8]) -> Result<u64> {
    require!(data.len() >= GLOBAL_MIN_LEN, Sl0tError::InvalidPumpGlobal);
    require!(data[..8] == GLOBAL_DISCRIMINATOR, Sl0tError::InvalidPumpGlobal);
    Ok(read_u64(data, INITIAL_REAL_TOKEN_RESERVES_OFFSET))
}

/// Graduation progress in basis points (0..=10_000).
/// Progress = tokens sold off the curve / tokens the curve started with.
pub fn progress_bps(curve: &CurveView, initial_real_tokens: u64) -> u16 {
    if curve.complete {
        return 10_000;
    }
    if initial_real_tokens == 0 || curve.real_token_reserves >= initial_real_tokens {
        return 0;
    }
    let sold = (initial_real_tokens - curve.real_token_reserves) as u128;
    let bps = sold * 10_000 / initial_real_tokens as u128;
    // A curve that is not complete is never shown as 100%.
    bps.min(9_999) as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    // Real mainnet snapshots, fetched 2026-11-11 (see tests/fixtures/mainnet-curves.json).
    // 11JLK9iWC2VwsaEarM7yoQtP5NfbuJyXjUwVrxCk9wC: complete curve, 141 bytes.
    // 11134iSgWxi8QLbVgrAe48yzbzcgBrd7ZDJjmSC67Wv: open curve, 166 bytes.
    const FIXTURE: &str = include_str!("../../../tests/fixtures/mainnet-curves.json");

    fn fixture_bytes(kind: &str) -> Vec<u8> {
        let key = format!("\"{}\"", kind);
        let start = FIXTURE.find(&key).expect("fixture kind");
        let rest = &FIXTURE[start..];
        let data_start = rest.find("\"data\"").expect("data field");
        let rest = &rest[data_start..];
        let q1 = rest.find('[').unwrap();
        let rest = &rest[q1..];
        let s = rest.find('"').unwrap() + 1;
        let e = s + rest[s..].find('"').unwrap();
        base64::engine::general_purpose::STANDARD
            .decode(&rest[s..e])
            .expect("base64")
    }

    #[test]
    fn parses_real_complete_curve() {
        let data = fixture_bytes("complete");
        assert_eq!(data.len(), 141);
        let c = parse_curve(&data).unwrap();
        assert!(c.complete);
        assert_eq!(c.real_token_reserves, 0);
        assert_eq!(progress_bps(&c, 793_100_000_000_000), 10_000);
    }

    #[test]
    fn parses_real_open_curve() {
        let data = fixture_bytes("open");
        assert_eq!(data.len(), 166);
        let c = parse_curve(&data).unwrap();
        assert!(!c.complete);
        assert!(c.real_token_reserves > 0);
        assert!(progress_bps(&c, 793_100_000_000_000) < 10_000);
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let mut data = fixture_bytes("open");
        data[0] ^= 0xff;
        assert!(parse_curve(&data).is_err());
    }

    #[test]
    fn progress_math() {
        let mut c = CurveView {
            real_token_reserves: 793_100_000_000_000,
            complete: false,
            creator: Pubkey::default(),
        };
        assert_eq!(progress_bps(&c, 793_100_000_000_000), 0);
        c.real_token_reserves = 396_550_000_000_000;
        assert_eq!(progress_bps(&c, 793_100_000_000_000), 5_000);
        c.real_token_reserves = 0;
        assert_eq!(progress_bps(&c, 793_100_000_000_000), 9_999);
    }
}
