//! Exact economic rules shared by the onchain program and adversarial host tests.
//! No floating point, external prices, or trusted keeper assertions.
pub const BPS: u64 = 10_000;
pub const PACK_PRICE: u64 = 10_000_000;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    InvalidAmount,
    InvalidFee,
    InvalidPrice,
    StalePrice,
    Confidence,
    NotTriggered,
}
pub type Result<T> = core::result::Result<T, MathError>;
pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(MathError::Overflow)
}
pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(MathError::InvalidAmount)
}
pub fn mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or(MathError::Overflow)
}
pub fn mul_div(a: u64, b: u64, d: u64, ceil: bool) -> Result<u64> {
    if d == 0 {
        return Err(MathError::InvalidAmount);
    }
    let n = (a as u128) * (b as u128);
    let q = n / d as u128 + u128::from(ceil && n % d as u128 != 0);
    q.try_into().map_err(|_| MathError::Overflow)
}
pub fn fee(amount: u64, bps: u16) -> Result<u64> {
    if bps as u64 > BPS {
        return Err(MathError::InvalidFee);
    }
    mul_div(amount, bps as u64, BPS, false)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RealizedYield {
    pub principal_value: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
    pub fee_carry: u16,
}
pub fn realize(redeemed: u64, cost_basis: u64, fee_bps: u16, carry: u16) -> Result<RealizedYield> {
    if fee_bps as u64 > BPS || carry as u64 >= BPS {
        return Err(MathError::InvalidFee);
    }
    let gross = redeemed.saturating_sub(cost_basis);
    let numerator = (gross as u128) * fee_bps as u128 + carry as u128;
    let fee = u64::try_from(numerator / BPS as u128).map_err(|_| MathError::Overflow)?;
    Ok(RealizedYield {
        principal_value: redeemed.min(cost_basis),
        gross,
        fee,
        net: sub(gross, fee)?,
        fee_carry: (numerator % BPS as u128) as u16,
    })
}
/// On loss, withdraw basis proportionally so recovered losses aren't later taxed as new profit.
pub fn remaining_basis(basis: u64, principal_value: u64, withdrawn: u64) -> Result<u64> {
    if withdrawn > principal_value {
        return Err(MathError::InvalidAmount);
    }
    if withdrawn == 0 {
        return Ok(basis);
    }
    if withdrawn == principal_value {
        return Ok(0);
    }
    sub(basis, mul_div(basis, withdrawn, principal_value, false)?)
}
pub fn pack_allocation(claimable: u64) -> (u64, u64) {
    (claimable / PACK_PRICE, claimable % PACK_PRICE)
}
pub fn pack_total(count: u64) -> Result<u64> {
    if count == 0 {
        return Err(MathError::InvalidAmount);
    }
    mul(count, PACK_PRICE)
}
#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub value: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub publish_time: i64,
}
impl Price {
    pub fn checked(self, now: i64, max_age: u32, max_confidence_bps: u16) -> Result<Self> {
        if self.value <= 0 || !(-12..=0).contains(&self.exponent) {
            return Err(MathError::InvalidPrice);
        }
        if self.publish_time > now
            || now
                .checked_sub(self.publish_time)
                .ok_or(MathError::StalePrice)?
                > max_age as i64
        {
            return Err(MathError::StalePrice);
        }
        if self.confidence as u128 * BPS as u128 > self.value as u128 * max_confidence_bps as u128 {
            return Err(MathError::Confidence);
        }
        Ok(self)
    }
}
/// Conservative equity / USDC oracle ratio, denominated in six-decimal USDC per stock token.
/// The stock numerator includes confidence; the USDC denominator subtracts it.
pub fn price_in_usdc(stock: Price, usdc: Price, ratio_num: u64, ratio_den: u64) -> Result<u64> {
    if stock.value <= 0
        || usdc.value <= 0
        || ratio_num == 0
        || ratio_den == 0
        || !(-12..=0).contains(&stock.exponent)
        || !(-12..=0).contains(&usdc.exponent)
    {
        return Err(MathError::InvalidPrice);
    }
    let numerator = (stock.value as u128)
        .checked_add(stock.confidence as u128)
        .and_then(|v| v.checked_mul(10u128.pow((-usdc.exponent) as u32)))
        .and_then(|v| v.checked_mul(1_000_000))
        .and_then(|v| v.checked_mul(ratio_num as u128))
        .ok_or(MathError::Overflow)?;
    let denominator = (usdc.value as u128)
        .checked_sub(usdc.confidence as u128)
        .filter(|v| *v > 0)
        .and_then(|v| v.checked_mul(10u128.pow((-stock.exponent) as u32)))
        .and_then(|v| v.checked_mul(ratio_den as u128))
        .ok_or(MathError::InvalidPrice)?;
    u64::try_from(numerator / denominator + u128::from(numerator % denominator != 0))
        .map_err(|_| MathError::Overflow)
}
pub fn minimum_stock(
    budget: u64,
    price: u64,
    decimals: u8,
    slippage_bps: u16,
    limit: Option<u64>,
) -> Result<u64> {
    if budget == 0 || price == 0 || decimals > 12 || slippage_bps > 100 {
        return Err(MathError::InvalidPrice);
    }
    if let Some(target) = limit {
        if price > target {
            return Err(MathError::NotTriggered);
        }
    }
    let price_cap =
        mul_div(price, BPS + slippage_bps as u64, BPS, true)?.min(limit.unwrap_or(u64::MAX));
    mul_div(budget, 10u64.pow(decimals as u32), price_cap, true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn realize_never_tax_principal_or_losses() {
        let r = realize(100_000_000, 100_000_000, 1000, 0).unwrap();
        assert_eq!(r.net, 0);
        let loss = realize(90_000_000, 100_000_000, 1000, 0).unwrap();
        assert_eq!(loss.principal_value, 90_000_000);
        assert_eq!(loss.fee, 0);
    }
    #[test]
    fn cents_and_fee_carry_conserve_every_base_unit() {
        let mut carry = 0;
        let mut fees = 0;
        let mut net = 0;
        for _ in 0..100_003 {
            let r = realize(101, 100, 1000, carry).unwrap();
            carry = r.fee_carry;
            fees += r.fee;
            net += r.net;
        }
        assert_eq!(fees, 10_000);
        assert_eq!(carry, 3000);
        assert_eq!(fees + net, 100_003);
    }
    #[test]
    fn multiple_packs_only_consume_net_yield() {
        let r = realize(145_000_000, 100_000_000, 1000, 0).unwrap();
        let (count, remainder) = pack_allocation(r.net);
        assert_eq!((count, remainder), (4, 500_000));
        assert_eq!(r.principal_value, 100_000_000);
    }
    #[test]
    fn loss_basis_survives_partial_redemption() {
        assert_eq!(remaining_basis(100, 80, 40), Ok(50));
        assert_eq!(realize(50, 50, 1000, 0).unwrap().fee, 0);
        assert_eq!(remaining_basis(100, 80, 81), Err(MathError::InvalidAmount));
    }
    #[test]
    fn checked_batch_and_fees() {
        assert_eq!(pack_total(0), Err(MathError::InvalidAmount));
        assert_eq!(pack_total(u64::MAX), Err(MathError::Overflow));
        assert_eq!(fee(PACK_PRICE, 200), Ok(200_000));
        assert!(fee(1, 10001).is_err());
    }
    fn p(value: i64, confidence: u64, exponent: i32) -> Price {
        Price {
            value,
            confidence,
            exponent,
            publish_time: 100,
        }
    }
    #[test]
    fn oracle_ratio_handles_depeg_and_decimals() {
        assert_eq!(
            price_in_usdc(p(150_0000, 0, -4), p(100_000_000, 0, -8), 1, 1),
            Ok(150_000_000)
        );
        assert_eq!(
            price_in_usdc(p(150_0000, 0, -4), p(50_000_000, 0, -8), 1, 1),
            Ok(300_000_000)
        );
        assert_eq!(
            minimum_stock(9_800_000, 150_000_000, 8, 0, None),
            Ok(6_533_334)
        );
    }
    #[test]
    fn reject_future_stale_uncertain_or_negative_oracles() {
        assert!(p(100, 1, -2).checked(99, 60, 100).is_err());
        assert!(p(100, 1, -2).checked(161, 60, 100).is_err());
        assert!(p(100, 2, -2).checked(100, 60, 100).is_err());
        assert!(p(-1, 0, -2).checked(100, 60, 100).is_err());
    }
    #[test]
    fn limit_price_cannot_be_bypassed_by_slippage() {
        assert_eq!(
            minimum_stock(10_000_000, 101_000_000, 8, 50, Some(100_000_000)),
            Err(MathError::NotTriggered)
        );
        assert_eq!(
            minimum_stock(10_000_000, 100_000_000, 8, 50, Some(100_000_000)),
            Ok(10_000_000)
        );
    }
    #[test]
    fn floor_math_cannot_overflow_intermediate() {
        assert_eq!(mul_div(u64::MAX, u64::MAX, u64::MAX, false), Ok(u64::MAX));
        assert!(mul_div(u64::MAX, u64::MAX, 1, false).is_err());
    }
}

/// Apply a Token-2022 Scaled UI Amount multiplier using its exact IEEE-754 bits.
/// No floating point arithmetic participates in custody or settlement amounts.
pub fn scaled_price(price: u64, bits: u64) -> Result<u64> {
    if bits >> 63 != 0 {
        return Err(MathError::InvalidPrice);
    }
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    if exponent == 0 || exponent == 0x7ff {
        return Err(MathError::InvalidPrice);
    }
    let mantissa = (bits & ((1u64 << 52) - 1)) | (1u64 << 52);
    let shift = exponent - 1023 - 52;
    let zeros = mantissa.trailing_zeros() as i32;
    let numerator = (mantissa >> zeros) as u128;
    let shift = shift + zeros;
    let value = (price as u128)
        .checked_mul(numerator)
        .ok_or(MathError::Overflow)?;
    let result = if shift >= 0 {
        if shift >= 128 {
            return Err(MathError::Overflow);
        }
        value
            .checked_mul(1u128 << shift)
            .ok_or(MathError::Overflow)?
    } else {
        if -shift >= 128 {
            return Err(MathError::InvalidPrice);
        }
        let divisor = 1u128 << (-shift);
        value / divisor + u128::from(value % divisor != 0)
    };
    u64::try_from(result).map_err(|_| MathError::Overflow)
}
#[cfg(test)]
mod scaled_tests {
    use super::*;
    #[test]
    fn exact_scaled_ui_multiplier() {
        assert_eq!(scaled_price(100_000_000, 1.5f64.to_bits()), Ok(150_000_000));
        assert_eq!(scaled_price(100_000_000, 0.5f64.to_bits()), Ok(50_000_000));
        assert_eq!(scaled_price(1, 1.5f64.to_bits()), Ok(2));
        assert!(scaled_price(100, f64::NAN.to_bits()).is_err());
        assert!(scaled_price(100, (-1f64).to_bits()).is_err());
    }
}
