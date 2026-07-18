import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LarkAccount } from '../src/core/types';
import type { FeishuMessageEvent, MessageContext } from '../src/messaging/types';

const { contactUserGetMock, resolveAgentRouteMock, resolveEnvelopeFormatOptionsMock, enqueueSystemEventMock } =
  vi.hoisted(() => ({
    contactUserGetMock: vi.fn(),
    resolveAgentRouteMock: vi.fn(() => ({
      sessionKey: 'agent:main:feishu:direct:ou_sender',
      accountId: 'dev',
    })),
    resolveEnvelopeFormatOptionsMock: vi.fn(() => ({})),
    enqueueSystemEventMock: vi.fn(),
  }));

vi.mock('../src/core/lark-client', () => ({
  LarkClient: {
    fromAccount: vi.fn(() => ({
      sdk: {
        contact: {
          user: {
            get: contactUserGetMock,
            batch: vi.fn(),
          },
        },
      },
    })),
    runtime: {
      channel: {
        reply: {
          resolveEnvelopeFormatOptions: resolveEnvelopeFormatOptionsMock,
        },
        routing: {
          resolveAgentRoute: resolveAgentRouteMock,
        },
      },
      system: {
        enqueueSystemEvent: enqueueSystemEventMock,
      },
    },
  },
}));

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { buildDispatchContext } from '../src/messaging/inbound/dispatch-context';
import { resolveSenderInfo } from '../src/messaging/inbound/enrich';
import { parseMessageEvent } from '../src/messaging/inbound/parse';
import { clearUserNameCache, getUserNameCache, resolveUserName } from '../src/messaging/inbound/user-name-cache';

const account = {
  accountId: 'dev',
  enabled: true,
  brand: 'feishu',
  configured: true,
  appId: 'cli_dev',
  appSecret: 'secret',
  config: {},
} as LarkAccount;

const log = vi.fn();

function createEvent(userId?: string): FeishuMessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: 'ou_sender',
        ...(userId ? { user_id: userId } : {}),
      },
      sender_type: 'user',
      tenant_key: 'tenant_dev',
    },
    message: {
      message_id: 'om_sender_identity',
      chat_id: 'oc_sender_identity',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: '/whoami' }),
    },
  };
}

function createContactUserResponse(params: { userId?: string; name?: string } = {}) {
  return {
    code: 0,
    msg: 'success',
    data: {
      user: {
        open_id: 'ou_sender',
        user_id: params.userId,
        union_id: 'on_sender',
        name: params.name ?? 'Alice',
        status: {
          is_activated: true,
          is_exited: false,
          is_frozen: false,
          is_resigned: false,
          is_unjoin: false,
        },
      },
    },
  };
}

async function parseAndResolve(event: FeishuMessageEvent): Promise<MessageContext> {
  const ctx = await parseMessageEvent(event);
  return (await resolveSenderInfo({ ctx, account, log })).ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearUserNameCache();
});

describe('Feishu sender identity', () => {
  it('resolves tenant user_id once and reuses it from the account cache', async () => {
    contactUserGetMock.mockResolvedValue(createContactUserResponse({ userId: 'u_tenant' }));

    const first = await parseAndResolve(createEvent());
    const second = await parseAndResolve(createEvent());

    expect(first).toMatchObject({
      senderId: 'ou_sender',
      senderUserId: 'u_tenant',
      senderName: 'Alice',
    });
    expect(second).toMatchObject({
      senderId: 'ou_sender',
      senderUserId: 'u_tenant',
      senderName: 'Alice',
    });
    expect(contactUserGetMock).toHaveBeenCalledTimes(1);
  });

  it('prefers raw event user_id and backfills it into the account cache', async () => {
    contactUserGetMock.mockResolvedValue(createContactUserResponse({ userId: 'u_from_lookup' }));

    const parsed = await parseMessageEvent(createEvent('u_from_event'));
    expect(parsed).toMatchObject({
      senderId: 'ou_sender',
      senderUserId: 'u_from_event',
    });

    const first = (await resolveSenderInfo({ ctx: parsed, account, log })).ctx;
    const second = await parseAndResolve(createEvent());

    expect(first).toMatchObject({
      senderId: 'ou_sender',
      senderUserId: 'u_from_event',
    });
    expect(second).toMatchObject({
      senderId: 'ou_sender',
      senderUserId: 'u_from_event',
    });
    expect(contactUserGetMock).toHaveBeenCalledTimes(1);
  });

  it('completes a name-only cache only when tenant identity is required', async () => {
    getUserNameCache(account.accountId).set('ou_sender', 'Mention Name');
    contactUserGetMock.mockResolvedValue(createContactUserResponse({ userId: 'u_tenant' }));

    const cachedName = await resolveUserName({ account, openId: 'ou_sender', log });
    expect(cachedName).toEqual({ name: 'Mention Name' });
    expect(contactUserGetMock).not.toHaveBeenCalled();

    const completed = await resolveUserName({
      account,
      openId: 'ou_sender',
      log,
      requireUserId: true,
    });

    expect(completed).toEqual({ name: 'Alice', userId: 'u_tenant' });
    expect(contactUserGetMock).toHaveBeenCalledTimes(1);
  });

  it('negative-caches a completed lookup without user_id', async () => {
    getUserNameCache(account.accountId).set('ou_sender', 'Mention Name');
    contactUserGetMock.mockResolvedValue(createContactUserResponse());

    const params = {
      account,
      openId: 'ou_sender',
      log,
      requireUserId: true,
    };
    const first = await resolveUserName(params);
    const second = await resolveUserName(params);

    expect(first).toEqual({ name: 'Alice' });
    expect(second).toEqual({ name: 'Alice' });
    expect(contactUserGetMock).toHaveBeenCalledTimes(1);
  });

  it('keeps routing and transport addresses on open_id', () => {
    const ctx: MessageContext = {
      chatId: 'oc_sender_identity',
      messageId: 'om_sender_identity',
      senderId: 'ou_sender',
      senderUserId: 'u_tenant',
      senderName: 'Alice',
      chatType: 'p2p',
      content: '/whoami',
      contentType: 'text',
      resources: [],
      mentions: [],
      mentionAll: false,
      rawMessage: {
        message_id: 'om_sender_identity',
        chat_id: 'oc_sender_identity',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '/whoami' }),
      },
      rawSender: {
        sender_id: {
          open_id: 'ou_sender',
          user_id: 'u_tenant',
        },
        sender_type: 'user',
      },
    };

    const dispatchContext = buildDispatchContext({
      ctx,
      account,
      accountScopedCfg: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    });

    expect(resolveAgentRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: { kind: 'direct', id: 'ou_sender' },
      }),
    );
    expect(dispatchContext.feishuFrom).toBe('feishu:ou_sender');
    expect(dispatchContext.feishuTo).toBe('user:ou_sender');
    expect(dispatchContext.envelopeFrom).toBe('ou_sender');
  });
});
