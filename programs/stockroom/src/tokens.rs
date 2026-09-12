use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::{token, token_interface};
pub fn pay<'info>(
    program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    seeds: Option<&[&[u8]]>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let accounts = token::Transfer {
        from,
        to,
        authority,
    };
    match seeds {
        Some(seeds) => token::transfer(
            CpiContext::new_with_signer(program, accounts, &[seeds]),
            amount,
        ),
        None => token::transfer(CpiContext::new(program, accounts), amount),
    }
}
pub fn validate_stock(
    spec: &StockSpec,
    mint: &InterfaceAccount<token_interface::Mint>,
    program: Pubkey,
) -> Result<()> {
    require_keys_eq!(spec.mint, mint.key(), StockroomError::Mint);
    require_keys_eq!(spec.token_program, program, StockroomError::Mint);
    require_keys_eq!(*mint.to_account_info().owner, program, StockroomError::Mint);
    require!(spec.decimals == mint.decimals, StockroomError::Mint);
    Ok(())
}
pub fn deliver<'info>(
    program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    remaining: &[AccountInfo<'info>],
) -> Result<()> {
    anchor_spl::token_2022::spl_token_2022::onchain::invoke_transfer_checked(
        program.key,
        from,
        mint,
        to,
        authority,
        remaining,
        amount,
        decimals,
        &[],
    )
    .map_err(Into::into)
}

pub fn ui_multiplier_bits(mint: &AccountInfo) -> Result<u64> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(0x3ff0000000000000);
    }
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{
            scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions,
        },
        state::Mint,
    };
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data)?;
    if let Ok(scale) = state.get_extension::<ScaledUiAmountConfig>() {
        let now = Clock::get()?.unix_timestamp;
        let bits = if now >= i64::from(scale.new_multiplier_effective_timestamp) {
            scale.new_multiplier.0
        } else {
            scale.multiplier.0
        };
        Ok(u64::from_le_bytes(bits))
    } else {
        Ok(0x3ff0000000000000)
    }
}
