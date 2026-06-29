import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Loader2, User, Users, MessageSquare, Archive,
  Phone, Hash, ChevronRight, Clock, CheckCheck, Check, AlertCircle,
  Image, Video, Mic, FileText, MapPin, Contact2, Sticker, RefreshCw,
} from 'lucide-react';
import { sessionApi, type Session, type ChatMessage } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import './ChatHistory.css';

/* ─── Types ─────────────────────────────────────────────────────── */
type DbChat = {
  chatId: string;
  lastMessage: string | null;
  lastMessageType: string | null;
  lastTimestamp: number | null;
  messageCount: number;
  chatName: string | null;
  chatPhone: string | null;
};

/* ─── Helpers ────────────────────────────────────────────────────── */
const AVATAR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#06b6d4','#a855f7',
];

function avatarColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(chatId: string): string {
  const num = chatId.split('@')[0];
  return num.slice(0, 2).toUpperCase();
}

function chatDisplayName(chatId: string, chatName?: string | null, chatPhone?: string | null): string {
  if (chatName) return chatName.length > 28 ? chatName.slice(0, 28) + '…' : chatName;
  if (chatPhone) return chatPhone.length > 22 ? chatPhone.slice(0, 22) + '…' : chatPhone;
  // @lid is a WhatsApp privacy ID — not a real phone number
  if (chatId.endsWith('@lid')) return `Contact · ${chatId.split('@')[0].slice(-6)}`;
  if (chatId.endsWith('@g.us')) return `Group · ${chatId.split('@')[0].slice(-6)}`;
  return chatId.split('@')[0];
}

function chatSubtitle(chatId: string, chatName?: string | null, chatPhone?: string | null): string | null {
  // When we have a name, show the phone (or group ID) as subtitle
  if (chatName) {
    if (chatPhone) return chatPhone;
    if (chatId.endsWith('@g.us')) return chatId;
    if (chatId.endsWith('@lid')) return null;
    return chatId.split('@')[0];
  }
  // No name — subtitle not needed, the name line already shows phone/ID
  return null;
}

function lastMsgSnippet(body: string | null, type: string | null): string {
  if (body && body.trim()) return body;
  if (!type || type === 'text') return '';
  const labels: Record<string, string> = {
    image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio',
    voice: '🎤 Voice note', document: '📄 Document',
    sticker: '🩷 Sticker', location: '📍 Location',
    contact: '👤 Contact', revoked: '🚫 Deleted message',
    unknown: '📎 Attachment',
  };
  return labels[type] ?? `📎 ${type}`;
}

function isGroup(id: string): boolean {
  return id.endsWith('@g.us');
}

function sessionDotClass(status: string): 'ready' | 'offline' | 'pending' {
  if (status === 'ready') return 'ready';
  if (status === 'disconnected' || status === 'failed') return 'offline';
  return 'pending';
}

function fmtChatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtMsgTime(ts: number | null | undefined, createdAt: string): string {
  const epoch = ts ?? Math.floor(new Date(createdAt).getTime() / 1000);
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDateLabel(ts: number | null | undefined, createdAt: string): string {
  const epoch = ts ?? Math.floor(new Date(createdAt).getTime() / 1000);
  const d = new Date(epoch * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* Best label for displaying a message sender */
function resolveSenderLabel(msg: ChatMessage, isMe: boolean): string {
  if (isMe) {
    return msg.senderName ?? msg.sessionPushName ?? msg.sessionPhone ?? 'Me';
  }
  const name = msg.senderName;
  const phone = msg.senderPhone ?? msg.from?.split('@')[0];
  if (name && phone && name !== phone) return `${name} · ${phone}`;
  return name ?? phone ?? '';
}

function getMediaSrc(media?: { mimetype?: string; data?: string } | null): string {
  if (!media?.data) return '';
  if (media.data.startsWith('data:') || media.data.startsWith('http')) return media.data;
  return `data:${media.mimetype ?? 'application/octet-stream'};base64,${media.data}`;
}

/* Media type icon component */
function MediaIcon({ type }: { type: string }) {
  switch (type) {
    case 'image':    return <Image size={12} />;
    case 'video':    return <Video size={12} />;
    case 'audio':
    case 'voice':    return <Mic size={12} />;
    case 'document': return <FileText size={12} />;
    case 'location': return <MapPin size={12} />;
    case 'contact':  return <Contact2 size={12} />;
    case 'sticker':  return <Sticker size={12} />;
    default:         return <Hash size={12} />;
  }
}

/* Delivery status tick */
function StatusTick({ status }: { status?: string | null }) {
  if (!status) return null;
  switch (status) {
    case 'read':
      return <CheckCheck size={14} className="ch-tick read" />;
    case 'delivered':
      return <CheckCheck size={14} className="ch-tick delivered" />;
    case 'sent':
      return <Check size={14} className="ch-tick sent" />;
    case 'pending':
      return <Clock size={14} className="ch-tick pending" />;
    case 'failed':
      return <AlertCircle size={14} className="ch-tick failed" />;
    default:
      return null;
  }
}

/* ─── Component ──────────────────────────────────────────────────── */
export function ChatHistory() {
  useDocumentTitle('Chat History');
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const [chats, setChats] = useState<DbChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedChat, setSelectedChat] = useState<DbChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /* Load all sessions — includes disconnected */
  useEffect(() => {
    const load = async () => {
      try {
        setLoadingSessions(true);
        const list = await sessionApi.list();
        setSessions(list);
        if (list.length > 0) setSelectedSession(list[0]);
      } catch (err) {
        toast.error('Failed to load sessions', err instanceof Error ? err.message : undefined);
      } finally {
        setLoadingSessions(false);
      }
    };
    void load();
  }, [toast]);

  const loadChats = useCallback(
    async (sid: string) => {
      if (!sid) return;
      try {
        setLoadingChats(true);
        const data = await sessionApi.getDbChats(sid);
        setChats(data);
      } catch (err) {
        toast.error('Failed to load chats', err instanceof Error ? err.message : undefined);
        setChats([]);
      } finally {
        setLoadingChats(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (selectedSession) {
      setSelectedChat(null);
      setMessages([]);
      setSearch('');
      void loadChats(selectedSession.id);
    }
  }, [selectedSession, loadChats]);

  const loadMessages = useCallback(
    async (chatId: string, sessionId: string) => {
      try {
        setLoadingMessages(true);
        const data = await sessionApi.getChatMessages(sessionId, chatId, 300);
        setMessages([...data.messages].reverse());
      } catch (err) {
        toast.error('Failed to load messages', err instanceof Error ? err.message : undefined);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    if (selectedChat && selectedSession) {
      void loadMessages(selectedChat.chatId, selectedSession.id);
    }
  }, [selectedChat, selectedSession, loadMessages]);

  useEffect(() => {
    if (selectedChat && selectedSession) {
      void loadMessages(selectedChat.chatId, selectedSession.id);
    } else {
      setMessages([]);
    }
  }, [selectedChat, selectedSession, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* Build items list with date separators */
  const messageItems: Array<{ type: 'date'; label: string } | { type: 'msg'; msg: ChatMessage }> = [];
  let lastLabel = '';
  for (const msg of messages) {
    const label = fmtDateLabel(msg.timestamp, msg.createdAt);
    if (label !== lastLabel) {
      messageItems.push({ type: 'date', label });
      lastLabel = label;
    }
    messageItems.push({ type: 'msg', msg });
  }

  const filteredChats = chats.filter(c => {
    const name = (c.chatName ?? '').toLowerCase();
    const phone = (c.chatPhone ?? c.chatId.split('@')[0]).toLowerCase();
    const snippet = lastMsgSnippet(c.lastMessage, c.lastMessageType).toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || phone.includes(q) || snippet.includes(q) || c.chatId.toLowerCase().includes(q);
  });

  /* Session info from first message (survives session deletion) */
  const headerSession = messages[0]
    ? { phone: messages[0].sessionPhone, name: messages[0].sessionPushName }
    : { phone: selectedSession?.phone ?? null, name: selectedSession?.pushName ?? null };

  /* ─── Full-screen loading ── */
  if (loadingSessions) {
    return (
      <div className="ch-page">
        <div className="ch-fullscreen-state">
          <div className="ch-spinner-ring" />
          <p className="ch-state-title">Loading sessions…</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="ch-page">
        <div className="ch-fullscreen-state">
          <Archive size={52} className="ch-state-icon" />
          <p className="ch-state-title">No sessions yet</p>
          <p className="ch-state-body">Create a WhatsApp session and send or receive messages to see history here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ch-page">

      {/* ── Top bar ── */}
      <div className="ch-topbar">
        <div className="ch-topbar-left">
          <h1 className="ch-topbar-title">Chat History</h1>
          <span className="ch-badge ch-badge-purple">Read-only</span>
        </div>
        {selectedSession && (
          <div className="ch-topbar-right">
            <span className="ch-session-pill">
              <span className={`ch-dot ${sessionDotClass(selectedSession.status)}`} />
              <span className="ch-session-pill-name">{selectedSession.name}</span>
              {selectedSession.phone && (
                <span className="ch-session-pill-phone">{selectedSession.phone}</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── 3-panel layout ── */}
      <div className="ch-layout">

        {/* PANEL 1 – Sessions */}
        <div className="ch-panel ch-sessions">
          <div className="ch-panel-head">
            <span className="ch-panel-label">Sessions</span>
            <span className="ch-badge ch-badge-gray">{sessions.length}</span>
          </div>
          <div className="ch-sessions-scroll">
            {sessions.map(s => {
              const active = s.id === selectedSession?.id;
              return (
                <button
                  key={s.id}
                  className={`ch-session-item ${active ? 'active' : ''}`}
                  onClick={() => setSelectedSession(s)}
                >
                  <div
                    className="ch-session-avatar"
                    style={{ background: avatarColor(s.id) }}
                  >
                    {s.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="ch-session-meta">
                    <span className="ch-session-name">{s.name}</span>
                    <span className="ch-session-sub">
                      <span className={`ch-dot ${sessionDotClass(s.status)}`} />
                      {s.phone ?? s.status}
                    </span>
                  </div>
                  {active && <ChevronRight size={14} className="ch-session-arrow" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* PANEL 2 – Chat list */}
        <div className="ch-panel ch-chats">
          <div className="ch-panel-head">
            <span className="ch-panel-label">Conversations</span>
            {!loadingChats && (
              <span className="ch-badge ch-badge-gray">{filteredChats.length}</span>
            )}
          </div>

          <div className="ch-search-wrap">
            <Search size={14} className="ch-search-icon" />
            <input
              ref={searchRef}
              className="ch-search-input"
              type="text"
              placeholder="Search chats…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="ch-search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>

          <div className="ch-chats-scroll">
            {loadingChats ? (
              <div className="ch-panel-state">
                <Loader2 size={22} className="animate-spin ch-muted" />
                <span className="ch-muted">Loading…</span>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="ch-panel-state">
                <MessageSquare size={28} className="ch-state-icon" />
                <p className="ch-state-title">
                  {search ? 'No results' : 'No conversations'}
                </p>
                <p className="ch-state-body">
                  {search
                    ? `Nothing matched "${search}"`
                    : 'No messages have been stored for this session yet.'}
                </p>
              </div>
            ) : (
              filteredChats.map(chat => {
                const active = selectedChat?.chatId === chat.chatId;
                const color = avatarColor(chat.chatId);
                const group = isGroup(chat.chatId);
                return (
                  <div
                    key={chat.chatId}
                    className={`ch-chat-item ${active ? 'active' : ''}`}
                    onClick={() => setSelectedChat(chat)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setSelectedChat(chat)}
                  >
                    <div className="ch-chat-avatar" style={{ background: color }}>
                      {group ? <Users size={16} /> : initials(chat.chatId)}
                    </div>
                    <div className="ch-chat-info">
                      <div className="ch-chat-row1">
                        <span className="ch-chat-name" title={chat.chatId}>
                          {chatDisplayName(chat.chatId, chat.chatName, chat.chatPhone)}
                        </span>
                        <span className="ch-chat-time">{fmtChatTime(chat.lastTimestamp)}</span>
                      </div>
                      {chatSubtitle(chat.chatId, chat.chatName, chat.chatPhone) && (
                        <div className="ch-chat-phone">
                          {chatSubtitle(chat.chatId, chat.chatName, chat.chatPhone)}
                        </div>
                      )}
                      <div className="ch-chat-row2">
                        <span className="ch-chat-snippet">
                          {(() => {
                            const s = lastMsgSnippet(chat.lastMessage, chat.lastMessageType);
                            return s
                              ? s
                              : <span className="ch-muted ch-italic">No messages</span>;
                          })()}
                        </span>
                        <span className="ch-count-badge">{chat.messageCount}</span>
                      </div>
                    </div>
                    {active && <div className="ch-active-bar" />}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANEL 3 – Messages */}
        <div className="ch-panel ch-messages">
          {selectedChat ? (
            <>
              {/* Chat header */}
              <div className="ch-chat-header">
                <div
                  className="ch-chat-header-avatar"
                  style={{ background: avatarColor(selectedChat.chatId) }}
                >
                  {isGroup(selectedChat.chatId) ? <Users size={20} /> : initials(selectedChat.chatId)}
                </div>
                <div className="ch-chat-header-info">
                  <h2 className="ch-chat-header-name">{chatDisplayName(selectedChat.chatId, selectedChat.chatName, selectedChat.chatPhone)}</h2>
                  {chatSubtitle(selectedChat.chatId, selectedChat.chatName, selectedChat.chatPhone) && (
                    <p className="ch-chat-header-sub">{chatSubtitle(selectedChat.chatId, selectedChat.chatName, selectedChat.chatPhone)}</p>
                  )}
                </div>
                <div className="ch-chat-header-chips">
                  <span className="ch-badge ch-badge-green">
                    <MessageSquare size={10} />
                    {messages.length} / {selectedChat.messageCount} messages
                  </span>
                  {isGroup(selectedChat.chatId) && (
                    <span className="ch-badge ch-badge-indigo">
                      <Users size={10} /> Group
                    </span>
                  )}
                  {headerSession.phone && (
                    <span className="ch-badge ch-badge-gray">
                      <Phone size={10} />
                      {headerSession.name
                        ? `${headerSession.name} · ${headerSession.phone}`
                        : headerSession.phone}
                    </span>
                  )}
                  <button
                    className="ch-refresh-btn"
                    onClick={handleRefresh}
                    disabled={loadingMessages}
                    title="Reload messages"
                  >
                    <RefreshCw size={13} className={loadingMessages ? 'ch-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Messages body */}
              <div className="ch-msgs-body">
                {loadingMessages ? (
                  <div className="ch-panel-state flex-center">
                    <div className="ch-spinner-ring" />
                    <p className="ch-muted">Loading messages…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="ch-panel-state flex-center">
                    <MessageSquare size={44} className="ch-state-icon" />
                    <p className="ch-state-title">No messages stored</p>
                    <p className="ch-state-body">
                      Messages will appear here once the gateway sends or receives some in this chat.
                    </p>
                  </div>
                ) : (
                  <>
                    {messageItems.map((item, idx) => {
                      if (item.type === 'date') {
                        return (
                          <div key={`d-${idx}`} className="ch-date-sep">
                            <div className="ch-date-line" />
                            <span className="ch-date-pill">{item.label}</span>
                            <div className="ch-date-line" />
                          </div>
                        );
                      }

                      const { msg } = item;
                      const isMe = msg.direction === 'outgoing';
                      const isRevoked = msg.type === 'revoked';
                      const isSticker = msg.type === 'sticker';
                      const isMedia = !isRevoked && !isSticker && msg.type !== 'text';
                      const senderLabel = resolveSenderLabel(msg, isMe);
                      const avatarKey = msg.senderPhone ?? msg.from ?? msg.chatId;
                      const time = fmtMsgTime(msg.timestamp, msg.createdAt);

                      /* Sticker image src — data may be: raw base64, full data-URL, or http URL */
                      const stickerSrc = (() => {
                        if (!isSticker) return null;
                        const d = msg.metadata?.media?.data;
                        if (!d) return null;
                        if (d.startsWith('data:') || d.startsWith('http')) return d;
                        return `data:${msg.metadata?.media?.mimetype ?? 'image/webp'};base64,${d}`;
                      })();

                      return (
                        <div key={msg.id} className={`ch-msg-row ${isMe ? 'out' : 'in'}`}>
                          {/* Incoming avatar — not shown for stickers (transparent) */}
                          {!isMe && !isSticker && (
                            <div
                              className="ch-msg-avatar"
                              style={{ background: avatarColor(avatarKey) }}
                              title={senderLabel}
                            >
                              <User size={12} />
                            </div>
                          )}

                          <div className="ch-msg-col">
                            {/* Sender label — always show for incoming; show for outgoing in groups */}
                            {(!isMe || isGroup(selectedChat.chatId)) && senderLabel && !isSticker && (
                              <span className={`ch-msg-sender ${isMe ? 'out' : 'in'}`}>
                                {senderLabel}
                              </span>
                            )}

                            {/* Bubble */}
                            <div className={`ch-bubble ${isMe ? 'out' : 'in'} ${isRevoked ? 'revoked' : ''} ${isSticker ? 'sticker' : ''}`}>
                              {isRevoked ? (
                                <span className="ch-bubble-revoked">🚫 This message was deleted</span>
                              ) : isSticker ? (
                                /* ── Sticker ── */
                                stickerSrc
                                  ? <img src={stickerSrc} alt="sticker" className="ch-sticker-img" />
                                  : (
                                    <div className="ch-sticker-placeholder">
                                      <Sticker size={20} />
                                      <span>Sticker</span>
                                    </div>
                                  )
                              ) : (
                                <>
                                  {isMedia && (() => {
                                    const media = msg.metadata?.media as { mimetype?: string; data?: string; filename?: string } | undefined;
                                    const src = getMediaSrc(media);
                                    if (msg.type === 'image') {
                                      return src
                                        ? <img src={src} alt="Photo" className="ch-media-img" />
                                        : <div className="ch-media-tag"><MediaIcon type={msg.type} /><span>Photo</span></div>;
                                    }
                                    if (msg.type === 'video') {
                                      return src
                                        ? <video src={src} controls className="ch-media-video" />
                                        : <div className="ch-media-tag"><MediaIcon type={msg.type} /><span>Video</span></div>;
                                    }
                                    if (msg.type === 'audio' || msg.type === 'voice') {
                                      return src
                                        ? <audio src={src} controls className="ch-media-audio" />
                                        : <div className="ch-media-tag"><MediaIcon type={msg.type} /><span>Audio</span></div>;
                                    }
                                    if (msg.type === 'document') {
                                      return src
                                        ? <a href={src} download={media?.filename ?? 'document'} className="ch-media-doc"><MediaIcon type={msg.type} /><span>{media?.filename ?? 'Document'}</span></a>
                                        : <div className="ch-media-tag"><MediaIcon type={msg.type} /><span>{media?.filename ?? 'Document'}</span></div>;
                                    }
                                    return <div className="ch-media-tag"><MediaIcon type={msg.type} /><span>{msg.type}</span></div>;
                                  })()}
                                  {msg.body && (
                                    <p className="ch-bubble-text">{msg.body}</p>
                                  )}
                                </>
                              )}

                              {/* Footer: hide for stickers — they're transparent, no footer needed */}
                              {!isSticker && (
                                <div className="ch-bubble-foot">
                                  <span className="ch-bubble-time">{time}</span>
                                  {isMe && <StatusTick status={msg.status} />}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="ch-panel-state flex-center ch-msgs-placeholder">
              <div className="ch-placeholder-icon-wrap">
                <MessageSquare size={40} />
              </div>
              <p className="ch-state-title">Select a conversation</p>
              <p className="ch-state-body">
                Choose a session, then pick a chat to read its stored history.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
