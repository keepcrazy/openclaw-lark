import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchReplyWithBufferedBlockDispatcherMock, sendCardFeishuMock, sendMessageFeishuMock } = vi.hoisted(() => ({
  dispatchReplyWithBufferedBlockDispatcherMock: vi.fn(),
  sendCardFeishuMock: vi.fn().mockResolvedValue({}),
  sendMessageFeishuMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/core/lark-client', () => ({
  LarkClient: {
    runtime: {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: dispatchReplyWithBufferedBlockDispatcherMock,
        },
      },
    },
  },
}));

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../src/core/lark-ticket', () => ({
  ticketElapsed: () => 1,
}));

vi.mock('../src/card/reply-dispatcher', () => ({
  createFeishuReplyDispatcher: vi.fn(),
}));

vi.mock('../src/card/tool-use-trace-store', () => ({
  startToolUseTraceRun: vi.fn(),
}));

vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: sendCardFeishuMock,
  sendMessageFeishu: sendMessageFeishuMock,
}));

vi.mock('../src/messaging/inbound/dispatch-builders', () => ({
  buildInboundPayload: vi.fn(),
}));

import { dispatchSystemCommand } from '../src/messaging/inbound/dispatch-commands';

function createDispatchContext(content: string) {
  return {
    ctx: {
      chatId: 'chat-1',
      messageId: 'om_msg_1',
      senderId: 'ou_sender_1',
      content,
    },
    accountScopedCfg: {} as never,
    account: { accountId: 'default' },
    log: vi.fn(),
    error: vi.fn(),
    core: {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: dispatchReplyWithBufferedBlockDispatcherMock,
        },
      },
    },
    isThread: false,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchSystemCommand', () => {
  it('delivers card-only structured payloads and preserves reply metadata', async () => {
    const card = {
      schema: '2.0',
      body: { elements: [{ tag: 'markdown', content: '**Status:** OK' }] },
    };
    dispatchReplyWithBufferedBlockDispatcherMock.mockImplementationOnce(
      async (params: {
        dispatcherOptions: {
          deliver: (
            payload: { text?: string; channelData?: Record<string, unknown> },
            info: { kind: 'tool' | 'final' | 'block' },
          ) => Promise<void>;
        };
      }) => {
        await params.dispatcherOptions.deliver({ channelData: { feishu: { card } } }, { kind: 'final' });
      },
    );

    await dispatchSystemCommand(createDispatchContext('/status'), {} as never, 'om_reply_1');

    expect(sendCardFeishuMock).toHaveBeenCalledTimes(1);
    expect(sendCardFeishuMock).toHaveBeenCalledWith({
      cfg: {},
      to: 'chat-1',
      card,
      replyToMessageId: 'om_reply_1',
      accountId: 'default',
      replyInThread: false,
    });
    expect(sendMessageFeishuMock).not.toHaveBeenCalled();
  });

  it.each(['/new', '/reset'])(
    'suppresses tool detail deliveries for %s session lifecycle commands',
    async (command) => {
      dispatchReplyWithBufferedBlockDispatcherMock.mockImplementationOnce(
        async (params: {
          dispatcherOptions: {
            deliver: (payload: { text?: string }, info: { kind: 'tool' | 'final' | 'block' }) => Promise<void>;
          };
          replyOptions: {
            shouldEmitToolResult?: () => boolean;
            shouldEmitToolOutput?: () => boolean;
          };
        }) => {
          expect(params.replyOptions.shouldEmitToolResult).toBeUndefined();
          expect(params.replyOptions.shouldEmitToolOutput).toBeUndefined();

          await params.dispatcherOptions.deliver({ text: '📖 Read startup.md' }, { kind: 'tool' });
          await params.dispatcherOptions.deliver({ text: 'New session started' }, { kind: 'final' });
        },
      );

      await dispatchSystemCommand(createDispatchContext(command), {} as never, 'om_reply_1');

      expect(sendMessageFeishuMock).toHaveBeenCalledTimes(1);
      expect(sendMessageFeishuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'New session started',
        }),
      );
    },
  );

  it('keeps tool detail deliveries for non-session system commands', async () => {
    dispatchReplyWithBufferedBlockDispatcherMock.mockImplementationOnce(
      async (params: {
        dispatcherOptions: {
          deliver: (payload: { text?: string }, info: { kind: 'tool' | 'final' | 'block' }) => Promise<void>;
        };
        replyOptions: {
          shouldEmitToolResult?: () => boolean;
          shouldEmitToolOutput?: () => boolean;
        };
      }) => {
        expect(params.replyOptions.shouldEmitToolResult).toBeUndefined();
        expect(params.replyOptions.shouldEmitToolOutput).toBeUndefined();

        await params.dispatcherOptions.deliver({ text: '🔧 Help lookup' }, { kind: 'tool' });
        await params.dispatcherOptions.deliver({ text: 'Help text' }, { kind: 'final' });
      },
    );

    await dispatchSystemCommand(createDispatchContext('/help'), {} as never, 'om_reply_1');

    expect(sendMessageFeishuMock).toHaveBeenCalledTimes(2);
    expect(sendMessageFeishuMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: '🔧 Help lookup',
      }),
    );
    expect(sendMessageFeishuMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: 'Help text',
      }),
    );
  });
});
