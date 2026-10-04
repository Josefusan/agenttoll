//! USD prices as integer atomic units. USDC has 6 decimals on Solana and Base (KB-AMT-01),
//! so $0.002 is 2000. Prices are parsed from decimal strings; floats never touch the money path.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer};

/// Decimal places of USDC on every supported network (KB-AMT-01).
pub const USDC_DECIMALS: u32 = 6;
const SCALE: u64 = 10u64.pow(USDC_DECIMALS);

/// An amount of USDC in atomic units (1 = $0.000001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Atomic(pub u64);

impl Atomic {
    pub const ZERO: Atomic = Atomic(0);

    pub fn is_free(self) -> bool {
        self.0 == 0
    }

    pub fn checked_add(self, other: Atomic) -> Option<Atomic> {
        self.0.checked_add(other.0).map(Atomic)
    }
}

impl fmt::Display for Atomic {
    /// Formats as a USD string with trailing zeros trimmed: 2000 -> "0.002".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let whole = self.0 / SCALE;
        let frac = self.0 % SCALE;
        if frac == 0 {
            return write!(f, "{whole}");
        }
        let digits = format!("{frac:0width$}", width = USDC_DECIMALS as usize);
        write!(f, "{whole}.{}", digits.trim_end_matches('0'))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MoneyError {
    #[error("price {0:?} is not a non-negative decimal like \"0.002\"")]
    Malformed(String),
    #[error("price {0:?} has more than {USDC_DECIMALS} decimal places")]
    TooPrecise(String),
    #[error("price {0:?} is too large")]
    Overflow(String),
}

impl FromStr for Atomic {
    type Err = MoneyError;

    /// Parses a USD decimal string ("0.002", "1", "$0.05") into atomic units exactly.
    fn from_str(input: &str) -> Result<Self, Self::Err> {
        let s = input.trim();
        let s = s.strip_prefix('$').unwrap_or(s);
        let malformed = || MoneyError::Malformed(input.to_string());

        let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
        if whole.is_empty() && frac.is_empty() {
            return Err(malformed());
        }
        let all_digits = |p: &str| p.bytes().all(|b| b.is_ascii_digit());
        if !all_digits(whole) || !all_digits(frac) || (s.contains('.') && frac.is_empty()) {
            return Err(malformed());
        }
        if frac.len() > USDC_DECIMALS as usize {
            return Err(MoneyError::TooPrecise(input.to_string()));
        }

        let overflow = || MoneyError::Overflow(input.to_string());
        let whole: u64 = if whole.is_empty() {
            0
        } else {
            whole.parse().map_err(|_| overflow())?
        };
        let frac_padded = format!("{frac:0<width$}", width = USDC_DECIMALS as usize);
        let frac: u64 = frac_padded.parse().map_err(|_| malformed())?;

        whole
            .checked_mul(SCALE)
            .and_then(|w| w.checked_add(frac))
            .map(Atomic)
            .ok_or_else(overflow)
    }
}

impl<'de> Deserialize<'de> for Atomic {
    /// Accepts a quoted decimal string. Bare YAML/JSON numbers are rejected on purpose:
    /// they arrive as floats, and 0.1 + 0.2 style rounding has no place in a price.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kb_amt_examples() {
        // KB-AMT-01
        assert_eq!("0.002".parse(), Ok(Atomic(2000)));
        assert_eq!("0.001".parse(), Ok(Atomic(1000)));
        assert_eq!("0.05".parse(), Ok(Atomic(50_000)));
    }

    #[test]
    fn parses_edge_forms() {
        assert_eq!("0".parse(), Ok(Atomic(0)));
        assert_eq!("1".parse(), Ok(Atomic(1_000_000)));
        assert_eq!(".5".parse(), Ok(Atomic(500_000)));
        assert_eq!("$0.25".parse(), Ok(Atomic(250_000)));
        assert_eq!(" 0.000001 ".parse(), Ok(Atomic(1)));
        assert_eq!("12.3".parse(), Ok(Atomic(12_300_000)));
    }

    #[test]
    fn rejects_bad_input() {
        for bad in ["", ".", "-1", "1.", "abc", "1e3", "0.0.1", "1,5", "+1"] {
            assert!(
                matches!(bad.parse::<Atomic>(), Err(MoneyError::Malformed(_))),
                "{bad:?}"
            );
        }
        assert!(matches!(
            "0.0000001".parse::<Atomic>(),
            Err(MoneyError::TooPrecise(_))
        ));
        assert!(matches!(
            "99999999999999999999".parse::<Atomic>(),
            Err(MoneyError::Overflow(_))
        ));
    }

    #[test]
    fn displays_trimmed_usd() {
        assert_eq!(Atomic(2000).to_string(), "0.002");
        assert_eq!(Atomic(1_000_000).to_string(), "1");
        assert_eq!(Atomic(1_500_000).to_string(), "1.5");
        assert_eq!(Atomic(1).to_string(), "0.000001");
        assert_eq!(Atomic(0).to_string(), "0");
    }

    #[test]
    fn round_trips() {
        for n in [0u64, 1, 999, 2000, 50_000, 1_000_000, 123_456_789] {
            assert_eq!(Atomic(n).to_string().parse(), Ok(Atomic(n)));
        }
    }

    #[test]
    fn deserialize_rejects_bare_numbers() {
        assert_eq!(
            serde_json::from_str::<Atomic>("\"0.002\"").unwrap(),
            Atomic(2000)
        );
        assert!(serde_json::from_str::<Atomic>("0.002").is_err());
    }
}
