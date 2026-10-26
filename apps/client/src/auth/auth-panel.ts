import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  LoginRequest,
  PASSWORD_MAX,
  PASSWORD_MIN,
  type PublicUser,
  RecoveryConfirmRequest,
  RecoveryRequest,
  RegisterRequest,
} from '@bar/shared';
import { type ApiResult, type AuthApi, errorMessage } from './api.ts';

export type AuthMode = 'login' | 'register' | 'recover' | 'reset';

type Field = 'email' | 'password' | 'displayName' | 'newPassword';

interface FieldSpec {
  label: string;
  type: string;
  autocomplete: string;
  hint?: string;
  invalid: string;
}

const FIELDS: Record<Field, FieldSpec> = {
  displayName: {
    label: 'Nome no jogo',
    type: 'text',
    autocomplete: 'nickname',
    hint: `${DISPLAY_NAME_MIN} a ${DISPLAY_NAME_MAX} caracteres: letras, números, espaço, ".", "_" ou "-".`,
    invalid: `Use ${DISPLAY_NAME_MIN} a ${DISPLAY_NAME_MAX} caracteres: letras, números, espaço, ".", "_" ou "-".`,
  },
  email: { label: 'E-mail', type: 'email', autocomplete: 'email', invalid: 'Informe um e-mail válido.' },
  password: {
    label: 'Senha',
    type: 'password',
    autocomplete: 'current-password',
    invalid: 'Informe a senha.',
  },
  newPassword: {
    label: 'Nova senha',
    type: 'password',
    autocomplete: 'new-password',
    hint: `${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres. Frases longas são ótimas senhas.`,
    invalid: `A senha precisa ter de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres.`,
  },
};

const MODES: Record<AuthMode, { title: string; submit: string; fields: Field[] }> = {
  login: { title: 'Entrar', submit: 'Entrar', fields: ['email', 'password'] },
  register: { title: 'Criar conta', submit: 'Criar conta', fields: ['displayName', 'email', 'newPassword'] },
  recover: { title: 'Recuperar acesso', submit: 'Enviar link', fields: ['email'] },
  reset: { title: 'Definir nova senha', submit: 'Salvar senha', fields: ['newPassword'] },
};

/**
 * Minimal, accessible account UI (labels, autocomplete, aria-invalid/aria-describedby, live regions, busy state).
 * Validates with the shared schemas before calling the API; the server validates again.
 */
export class AuthPanel {
  readonly root: HTMLElement;
  private readonly api: AuthApi;
  private readonly onAuthenticated: (user: PublicUser) => void;
  private mode: AuthMode = 'login';
  private resetToken = '';
  private listeners = new AbortController();

  constructor(parent: HTMLElement, api: AuthApi, onAuthenticated: (user: PublicUser) => void) {
    this.api = api;
    this.onAuthenticated = onAuthenticated;
    this.root = document.createElement('section');
    this.root.id = 'auth';
    this.root.setAttribute('aria-labelledby', 'auth-title');
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(mode: AuthMode, opts: { notice?: string; error?: string; resetToken?: string } = {}): void {
    this.mode = mode;
    if (opts.resetToken !== undefined) this.resetToken = opts.resetToken;
    this.render(opts);
    this.root.hidden = false;
    this.root.querySelector<HTMLInputElement>('input')?.focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.listeners.abort();
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  private render(opts: { notice?: string; error?: string }): void {
    this.listeners.abort();
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    const spec = MODES[this.mode];

    const title = el('h1', { id: 'auth-title' }, spec.title);
    const form = el('form', { id: 'auth-form', novalidate: '' });
    const error = el('p', { id: 'auth-error', role: 'alert', class: 'auth-error' }, opts.error ?? '');
    const notice = el('p', { id: 'auth-notice', role: 'status', class: 'auth-notice' }, opts.notice ?? '');
    for (const f of spec.fields) form.append(this.fieldRow(f));
    const submit = el('button', { id: 'auth-submit', type: 'submit' }, spec.submit);
    form.append(error, submit);

    const links = el('nav', { class: 'auth-links', 'aria-label': 'Outras opções' });
    const link = (mode: AuthMode, text: string) => {
      const b = el('button', { type: 'button', class: 'link', 'data-mode': mode }, text);
      b.addEventListener('click', () => this.show(mode), { signal });
      links.append(b);
    };
    if (this.mode !== 'login') link('login', 'Já tenho conta');
    if (this.mode !== 'register') link('register', 'Criar conta');
    if (this.mode === 'login') link('recover', 'Esqueci a senha');

    form.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        void this.submit(form, submit, error, notice);
      },
      { signal },
    );
    this.root.replaceChildren(title, notice, form, links);
  }

  private fieldRow(field: Field): HTMLElement {
    const spec = FIELDS[field];
    const id = `auth-${field}`;
    const input = el('input', { id, name: field, type: spec.type, autocomplete: spec.autocomplete, required: '' });
    const described: string[] = [];
    const row = el('div', { class: 'field' }, el('label', { for: id }, spec.label), input);
    if (spec.hint) {
      row.append(el('small', { id: `${id}-hint` }, spec.hint));
      described.push(`${id}-hint`);
    }
    row.append(el('small', { id: `${id}-error`, class: 'field-error' }));
    described.push(`${id}-error`);
    input.setAttribute('aria-describedby', described.join(' '));
    return row;
  }

  private async submit(
    form: HTMLFormElement,
    button: HTMLButtonElement,
    error: HTMLElement,
    notice: HTMLElement,
  ): Promise<void> {
    const values = Object.fromEntries(new FormData(form)) as Record<Field, string>;
    error.textContent = '';
    notice.textContent = '';
    const invalid = this.validate(values);
    for (const f of MODES[this.mode].fields) {
      const input = form.querySelector<HTMLInputElement>(`#auth-${f}`)!;
      const bad = invalid.has(f);
      input.setAttribute('aria-invalid', String(bad));
      form.querySelector(`#auth-${f}-error`)!.textContent = bad ? FIELDS[f].invalid : '';
    }
    if (invalid.size > 0) {
      form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const label = button.textContent;
    button.textContent = 'Aguarde…';
    try {
      const result = await this.send(values);
      if (!result.ok) {
        error.textContent = errorMessage(result.code, result.retryAfterSeconds);
        return;
      }
      if (result.data) {
        this.onAuthenticated(result.data);
      } else if (this.mode === 'recover') {
        notice.textContent =
          'Se existir uma conta com este e-mail, enviamos um link para redefinir a senha. Ele expira em breve.';
      } else if (this.mode === 'reset') {
        this.resetToken = '';
        this.show('login', { notice: 'Senha alterada. Entre com a nova senha.' });
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
        form.removeAttribute('aria-busy');
      }
    }
  }

  private validate(v: Record<Field, string>): Set<Field> {
    const schema = {
      login: () => LoginRequest.safeParse({ email: v.email, password: v.password }),
      register: () =>
        RegisterRequest.safeParse({ email: v.email, password: v.newPassword, displayName: v.displayName }),
      recover: () => RecoveryRequest.safeParse({ email: v.email }),
      reset: () => RecoveryConfirmRequest.safeParse({ token: this.resetToken, newPassword: v.newPassword }),
    }[this.mode]();
    const bad = new Set<Field>();
    if (schema.success) return bad;
    for (const issue of schema.error.issues) {
      const key = issue.path[0];
      // The register/reset contracts call the new password `password`/`newPassword`; the form uses `newPassword`.
      if (key === 'password') bad.add(this.mode === 'register' ? 'newPassword' : 'password');
      else if (key === 'email' || key === 'displayName' || key === 'newPassword') bad.add(key);
    }
    return bad;
  }

  private send(v: Record<Field, string>): Promise<ApiResult<PublicUser | undefined>> {
    switch (this.mode) {
      case 'login':
        return this.api.login({ email: v.email, password: v.password });
      case 'register':
        return this.api.register({ email: v.email, password: v.newPassword, displayName: v.displayName });
      case 'recover':
        return this.api.requestRecovery(v.email);
      case 'reset':
        return this.api.confirmRecovery({ token: this.resetToken, newPassword: v.newPassword });
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
