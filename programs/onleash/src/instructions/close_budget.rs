use anchor_lang::prelude::*;
use anchor_spl::token::{
    close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
};

use crate::error::OnleashError;
use crate::state::AgentBudget;

#[derive(Accounts)]
pub struct CloseBudget<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ OnleashError::OwnerMismatch,
        has_one = mint @ OnleashError::MintMismatch,
        close = owner,
    )]
    pub agent_budget: Box<Account<'info, AgentBudget>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = agent_budget,
    )]
    pub budget_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_close_budget(ctx: Context<CloseBudget>) -> Result<()> {
    let amount = ctx.accounts.budget_ata.amount;
    let mint_decimals = ctx.accounts.mint.decimals;

    let owner_key = ctx.accounts.agent_budget.owner;
    let delegate_key = ctx.accounts.agent_budget.delegate;
    let bump = ctx.accounts.agent_budget.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"agent",
        owner_key.as_ref(),
        delegate_key.as_ref(),
        &[bump],
    ]];

    if amount > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.budget_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.owner_ata.to_account_info(),
            authority: ctx.accounts.agent_budget.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        transfer_checked(cpi_ctx, amount, mint_decimals)?;
    }

    let close_accounts = CloseAccount {
        account: ctx.accounts.budget_ata.to_account_info(),
        destination: ctx.accounts.owner.to_account_info(),
        authority: ctx.accounts.agent_budget.to_account_info(),
    };
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        signer_seeds,
    );
    close_account(close_ctx)?;

    Ok(())
}
