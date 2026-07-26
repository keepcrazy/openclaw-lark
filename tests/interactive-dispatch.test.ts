import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchPluginInteractiveHandlerMock, pluginHandlerMock } = vi.hoisted(() => ({
  dispatchPluginInteractiveHandlerMock: vi.fn(),
  pluginHandlerMock: vi.fn(),
}));

vi.mock('openclaw/plugin-sdk/plugin-runtime', () => ({
  dispatchPluginInteractiveHandler: (...args: unknown[]) => dispatchPluginInteractiveHandlerMock(...args),
}));

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: vi.fn(),
  sendMessageFeishu: vi.fn(),
  updateCardFeishu: vi.fn(),
}));

import { dispatchFeishuPluginInteractiveHandler } from '../src/channel/interactive-dispatch';

describe('Feishu plugin interactive dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginHandlerMock.mockImplementation((context: unknown) => ({ context }));
    dispatchPluginInteractiveHandlerMock.mockImplementation(
      async (params: {
        invoke: (match: {
          registration: { handler: typeof pluginHandlerMock };
          namespace: string;
          payload: string;
        }) => Promise<{ handled?: boolean } | void>;
      }) => {
        const result = await params.invoke({
          registration: { handler: pluginHandlerMock },
          namespace: 'lark-speecher',
          payload: 'request-1:voice-1',
        });
        return {
          matched: true,
          handled: result?.handled ?? true,
          duplicate: false,
        };
      },
    );
  });

  it('passes both Feishu user_id and open_id without changing senderId', async () => {
    const result = await dispatchFeishuPluginInteractiveHandler({
      cfg: {},
      accountId: 'default',
      data: {
        operator: {
          user_id: 'user-1',
          open_id: 'ou_1',
        },
        open_chat_id: 'oc_1',
        open_message_id: 'om_1',
        action: {
          value: {
            action: 'lark-speecher:request-1:voice-1',
          },
        },
      },
    });

    expect(result).toEqual({
      context: expect.objectContaining({
        senderId: 'ou_1',
        senderOpenId: 'ou_1',
        senderUserId: 'user-1',
      }),
    });
  });

  it('keeps the open_id fields available when user_id is absent', async () => {
    const result = await dispatchFeishuPluginInteractiveHandler({
      cfg: {},
      accountId: 'default',
      data: {
        operator: {
          open_id: 'ou_1',
        },
        open_chat_id: 'oc_1',
        open_message_id: 'om_1',
        action: {
          value: {
            action: 'lark-speecher:request-1:voice-1',
          },
        },
      },
    });

    expect(result).toEqual({
      context: expect.objectContaining({
        senderId: 'ou_1',
        senderOpenId: 'ou_1',
        senderUserId: undefined,
      }),
    });
  });
});
