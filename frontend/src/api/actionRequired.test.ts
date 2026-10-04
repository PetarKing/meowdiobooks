import { describe, expect, it, vi } from 'vitest';
import { ActionRequiredError, readActionRequired, withActionRequired } from './actionRequired';
import type { WorkflowGateway } from './contracts';
import { HttpWizardApi } from './client';
import { message } from '../workflow/presentation';

const action = { code: 'HOST_REVIEW_REQUIRED', message: 'Review this action before continuing.', context: { bookId: 'book' } };

describe('provider-neutral required actions', () => {
  it('decodes a synchronous endpoint requirement without treating status alone as an action', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { actionRequired: action } }), { status: 402 }));
    const api = new HttpWizardApi('/api', fetcher);
    const error = await api.transcribeVoiceSample('book', new File(['voice'], 'sample.wav')).catch(reason => reason);
    expect(error).toBeInstanceOf(ActionRequiredError);
    expect(error).toMatchObject({ actionRequired: action, status: 402, handled: false });
    expect(message(error)).toBe(action.message);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: 'Service unavailable' }), { status: 503 }));
    await expect(api.listBooks()).rejects.not.toBeInstanceOf(ActionRequiredError);
  });

  it('only suppresses an action after the host handles it and retains processing settings', async () => {
    const error = new ActionRequiredError(action);
    const gateway = { processStage: vi.fn().mockRejectedValue(error) } as unknown as WorkflowGateway;
    const handler = vi.fn().mockReturnValue(true);
    const settings = { chapterIds: ['one'], language: 'english' };
    const composed = withActionRequired(gateway, handler);
    await expect(composed.processStage('book', 'generate', settings)).rejects.toBe(error);
    expect(handler).toHaveBeenCalledWith(action, { bookId: 'book', stage: 'generate', settings });
    expect(message(error)).toBe('');
    await composed.processStage('book', 'generate', settings).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps an unrecognized action visible when the host declines it', async () => {
    const error = new ActionRequiredError(action);
    const gateway = { listBooks: vi.fn().mockRejectedValue(error) } as unknown as WorkflowGateway;
    await withActionRequired(gateway, () => false).listBooks().catch(() => undefined);
    expect(error.handled).toBe(false);
    expect(message(error)).toBe(action.message);
  });

  it('does not suppress arbitrary errors or malformed action descriptors', () => {
    expect(message(new Error('Try this step again.'))).toBe('Try this step again.');
    for (const value of [null, [], {}, { ...action, code: '' }, { ...action, context: [] }, { ...action, message: 3 }]) {
      expect(readActionRequired(value)).toBeUndefined();
    }
  });
});
