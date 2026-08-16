import { CashfreeProvider } from "./cashfree";
import type { PaymentProvider } from "./provider";

/**
 * The only place the app decides which gateway is in use. Adding Razorpay later
 * means implementing PaymentProvider in a sibling folder and extending this
 * switch — nothing else in the codebase changes.
 */
const providers: Record<string, () => PaymentProvider> = {
  cashfree: () => new CashfreeProvider(),
};

export const ACTIVE_PROVIDER = "cashfree";

export function getPaymentProvider(name: string = ACTIVE_PROVIDER): PaymentProvider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown payment provider: ${name}`);
  return factory();
}

export type { PaymentProvider } from "./provider";
