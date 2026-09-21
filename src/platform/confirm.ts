/**
 * Cross-platform confirmation and notification.
 *
 * The implementation lives in confirm.native.ts; Metro picks it by platform
 * extension. This file exists so imports have something to resolve to for
 * TypeScript, and so the contract is stated once.
 */

/** confirm asks a yes/no question and resolves true if the user said yes. */
export declare function confirm(title: string, message: string): Promise<boolean>;

/** notify shows a message with a single acknowledgement. */
export declare function notify(title: string, message: string): Promise<void>;
