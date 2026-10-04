import type { ActionRequired, ActionRequiredContext, WorkflowGateway } from './contracts';

/** Expected host intervention. Only a host that has shown the action may suppress it. */
export class ActionRequiredError extends Error {
  readonly actionRequired: ActionRequired;
  readonly status?: number;
  handled: boolean;

  constructor(actionRequired: ActionRequired, options: { handled?: boolean; status?: number } = {}) {
    super(actionRequired.message);
    this.name = 'ActionRequiredError';
    this.actionRequired = actionRequired;
    this.status = options.status;
    this.handled = options.handled ?? false;
  }
}

export function readActionRequired(value: unknown): ActionRequired | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const action = value as Partial<ActionRequired>;
  if (typeof action.code !== 'string' || !action.code.trim() || action.code.length > 128
    || typeof action.message !== 'string' || !action.message.trim() || action.message.length > 2048
    || !action.context || typeof action.context !== 'object' || Array.isArray(action.context)) return undefined;
  return { code: action.code, message: action.message, context: action.context };
}

export type ActionRequiredHandler = (action: ActionRequired, context: ActionRequiredContext) => boolean;

export function handleRequiredAction(error: ActionRequiredError, handler?: ActionRequiredHandler,
  context: ActionRequiredContext = {}) {
  if (!error.handled && handler) {
    error.handled = handler(error.actionRequired, context) === true;
  }
}

/** Preserve adapter methods and optional capabilities while handling typed host actions. */
export function withActionRequired(gateway: WorkflowGateway, handler: ActionRequiredHandler): WorkflowGateway {
  const methods = new Map<PropertyKey, { source: unknown; wrapped: (...args: unknown[]) => unknown }>();
  function report(reason: unknown, property: PropertyKey, args: unknown[]) {
    if (reason instanceof ActionRequiredError) {
      const context: ActionRequiredContext = {};
      if (typeof args[0] === 'string' && property !== 'getJob' && property !== 'cancelJob') context.bookId = args[0];
      if (property === 'processStage') {
        context.stage = String(args[1]);
        context.settings = args[2] as Record<string, unknown>;
      }
      handleRequiredAction(reason, handler, context);
    }
    throw reason;
  }
  return new Proxy(gateway, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const cached = methods.get(property);
      if (cached && cached.source === value) return cached.wrapped;
      const wrapped = (...args: unknown[]) => {
        let result;
        try { result = value.apply(target, args); }
        catch (reason) { return report(reason, property, args); }
        return result && typeof result.catch === 'function'
          ? result.catch((reason: unknown) => report(reason, property, args)) : result;
      };
      methods.set(property, { source: value, wrapped });
      return wrapped;
    },
  });
}
