import { describe, expect, it } from 'vitest';
import {
  ApiErrorResponse,
  DisplayName,
  Email,
  LoginRequest,
  Password,
  PublicUser,
  RecoveryConfirmRequest,
  RegisterRequest,
} from './index.ts';

describe('Email', () => {
  it('normalizes case and whitespace', () => {
    expect(Email.parse('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('accepts ASCII addresses only (avoids homoglyph duplicates)', () => {
    expect(Email.safeParse('josé@example.com').success).toBe(false);
  });

  it('rejects malformed and oversized addresses', () => {
    for (const bad of ['', 'alice', 'alice@', '@example.com', 'a b@example.com', `${'a'.repeat(250)}@example.com`]) {
      expect(Email.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('Password', () => {
  it('enforces length in code points, without composition rules', () => {
    expect(Password.safeParse('a'.repeat(9)).success).toBe(false);
    expect(Password.safeParse('a'.repeat(10)).success).toBe(true);
    expect(Password.safeParse('😀'.repeat(128)).success).toBe(true); // 256 UTF-16 units, 128 code points
    expect(Password.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('DisplayName', () => {
  it('trims, collapses inner whitespace and keeps accents', () => {
    expect(DisplayName.parse('  João   da\tSilva ')).toBe('João da Silva');
  });

  it('rejects too short/long names, control/invisible characters and leading punctuation', () => {
    for (const bad of ['ab', 'a'.repeat(21), 'bad\u0000name', 'zero​width', '<script>', '-dash', '   ']) {
      expect(DisplayName.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    for (const ok of ['Ana', 'mr_robot-2', 'Zoë.K', '李小龙']) expect(DisplayName.safeParse(ok).success, ok).toBe(true);
  });
});

describe('request contracts', () => {
  it('are strict: unknown fields are rejected (no mass assignment)', () => {
    const valid = { email: 'a@example.com', password: 'correct horse', displayName: 'Ana' };
    expect(RegisterRequest.safeParse(valid).success).toBe(true);
    expect(RegisterRequest.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
    expect(LoginRequest.safeParse({ email: 'a@example.com', password: 'x', id: 1 }).success).toBe(false);
  });

  it('login accepts any bounded password (policy changes must not lock out old accounts)', () => {
    expect(LoginRequest.safeParse({ email: 'a@example.com', password: 'short' }).success).toBe(true);
    expect(LoginRequest.safeParse({ email: 'a@example.com', password: '' }).success).toBe(false);
  });

  it('recovery tokens must be 43-char base64url', () => {
    const ok = { token: 'A'.repeat(43), newPassword: 'new password 1' };
    expect(RecoveryConfirmRequest.safeParse(ok).success).toBe(true);
    expect(RecoveryConfirmRequest.safeParse({ ...ok, token: `${'A'.repeat(42)}=` }).success).toBe(false);
  });
});

describe('response contracts', () => {
  it('PublicUser is a tolerant reader and carries no private fields', () => {
    const user = PublicUser.parse({
      id: '0b8f1c1e-3a51-4d1a-9a3e-1b2c3d4e5f60',
      displayName: 'Ana',
      createdAt: '2026-10-26T12:00:00.000Z',
      email: 'leak@example.com',
      futureField: 1,
    });
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'displayName', 'id']);
  });

  it('ApiErrorResponse accepts the documented shape', () => {
    expect(ApiErrorResponse.safeParse({ error: { code: 'rate_limited', message: 'x', requestId: 'r' } }).success).toBe(
      true,
    );
    expect(ApiErrorResponse.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(false);
  });
});
