// Always-visible connection indicator: status and number of players in the room.
import type { NetStatus } from './game-connection.ts';

const LABEL: Record<NetStatus, { text: string; color: string }> = {
  connecting: { text: 'Conectando…', color: '#e0b84c' },
  online: { text: 'Online', color: '#5ccf6e' },
  reconnecting: { text: 'Reconectando…', color: '#e0b84c' },
  offline: { text: 'Offline — recarregue a página', color: '#e0605c' },
  replaced: { text: 'Conta aberta em outra aba', color: '#e0605c' },
  'session-ended': { text: 'Sessão encerrada', color: '#e0605c' },
};

export class NetBadge {
  private readonly el: HTMLDivElement;
  private readonly dot: HTMLSpanElement;
  private readonly text: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'net-status';
    this.el.setAttribute('role', 'status');
    this.el.style.cssText =
      'position:fixed;bottom:12px;right:12px;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.6);' +
      'color:#f3e9dc;font:13px/1.2 system-ui,sans-serif;display:flex;gap:8px;align-items:center;pointer-events:none';
    this.dot = document.createElement('span');
    this.dot.style.cssText = 'width:9px;height:9px;border-radius:50%';
    this.text = document.createElement('span');
    this.el.append(this.dot, this.text);
    parent.append(this.el);
    this.update('connecting', 0, 0);
  }

  update(status: NetStatus, players: number, max: number): void {
    const l = LABEL[status];
    this.dot.style.background = l.color;
    this.el.dataset.status = status;
    this.text.textContent =
      status === 'online' ? `${l.text} · ${players}/${max} ${players === 1 ? 'jogador' : 'jogadores'}` : l.text;
  }

  dispose(): void {
    this.el.remove();
  }
}
