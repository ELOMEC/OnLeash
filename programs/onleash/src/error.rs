use anchor_lang::prelude::*;

#[error_code]
pub enum OnleashError {
    #[msg("Total allowance must be greater than zero")]
    InvalidAllowance,
    #[msg("Per-tx limit invalid (must be > 0 and <= total allowance)")]
    InvalidPerTxLimit,
    #[msg("Daily limit must be >= per-tx limit")]
    InvalidDailyLimit,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Deposit must be greater than zero")]
    InvalidDeposit,
    #[msg("Deposit exceeds total allowance")]
    DepositExceedsAllowance,
    #[msg("Payment amount must be greater than zero")]
    InvalidPaymentAmount,
    #[msg("Budget is paused")]
    BudgetPaused,
    #[msg("Budget has expired")]
    BudgetExpired,
    #[msg("Payment exceeds per-tx limit")]
    PerTxLimitExceeded,
    #[msg("Payment exceeds daily spending limit")]
    DailyLimitExceeded,
    #[msg("Payment would exceed total allowance")]
    AllowanceExceeded,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Delegate mismatch")]
    DelegateMismatch,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Owner mismatch")]
    OwnerMismatch,
}
