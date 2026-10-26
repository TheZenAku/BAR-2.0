import type { PublicUser } from '@bar/shared';

/** Signed-in indicator with the logout action. Shown only while a session is active. */
export class UserBar {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly listeners = new AbortController();

  constructor(parent: HTMLElement, onLogout: () => Promise<void>) {
    this.root = document.createElement('nav');
    this.root.id = 'user-bar';
    this.root.setAttribute('aria-label', 'Conta');
    this.root.hidden = true;
    this.name = document.createElement('span');
    this.name.id = 'user-name';
    this.button = document.createElement('button');
    this.button.id = 'logout';
    this.button.type = 'button';
    this.button.textContent = 'Sair';
    this.button.addEventListener(
      'click',
      async () => {
        this.button.disabled = true;
        this.button.textContent = 'Saindo…';
        try {
          await onLogout();
        } finally {
          this.button.disabled = false;
          this.button.textContent = 'Sair';
        }
      },
      { signal: this.listeners.signal },
    );
    this.root.append(this.name, this.button);
    parent.append(this.root);
  }

  show(user: PublicUser): void {
    this.name.textContent = user.displayName;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.name.textContent = '';
  }

  dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }
}
