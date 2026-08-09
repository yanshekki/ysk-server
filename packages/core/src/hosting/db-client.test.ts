import { describe, expect, it } from 'vitest';
import { renderMysqlProvisionSql, validateMysqlIdent } from './db-client.js';

describe('db-client pure', () => {
  it('validateMysqlIdent accepts valid identifiers', () => {
    expect(() => validateMysqlIdent('app_db', 'dbName')).not.toThrow();
    expect(() => validateMysqlIdent('A', 'x')).not.toThrow();
    expect(() => validateMysqlIdent('user_01', 'username')).not.toThrow();
  });

  it('validateMysqlIdent rejects invalid identifiers', () => {
    expect(() => validateMysqlIdent('1bad', 'dbName')).toThrow();
    expect(() => validateMysqlIdent('has-dash', 'dbName')).toThrow();
    expect(() => validateMysqlIdent('', 'dbName')).toThrow();
    expect(() => validateMysqlIdent('a'.repeat(65), 'dbName')).toThrow();
  });

  it('renderMysqlProvisionSql builds utf8mb4 create + grants with defaults', () => {
    const r = renderMysqlProvisionSql({ dbName: 'proj_db', username: 'proj_user' });
    expect(r.sql).toHaveLength(4);
    expect(r.sql[0]).toContain('CREATE DATABASE IF NOT EXISTS `proj_db`');
    expect(r.sql[0]).toContain('utf8mb4_unicode_ci');
    expect(r.sql[1]).toContain("'proj_user'@'%'");
    expect(r.sql[1]).toContain('CHANGE_ME');
    expect(r.sql[2]).toContain('GRANT ALL PRIVILEGES ON `proj_db`.*');
    expect(r.sql[3]).toBe('FLUSH PRIVILEGES;');
    expect(r.connectionHint).toEqual({
      database: 'proj_db',
      user: 'proj_user',
      host: 'localhost',
    });
  });

  it('renderMysqlProvisionSql uses custom host and password', () => {
    const r = renderMysqlProvisionSql({
      dbName: 'd1',
      username: 'u1',
      password: 's3cret',
      host: '10.0.0.%',
    });
    expect(r.sql[1]).toContain("'u1'@'10.0.0.%'");
    expect(r.sql[1]).toContain('s3cret');
    expect(r.connectionHint.host).toBe('10.0.0.%');
  });

  it('renderMysqlProvisionSql escapes password injection and rejects bad host', () => {
    const r = renderMysqlProvisionSql({
      dbName: 'd1',
      username: 'u1',
      password: "x'; DROP DATABASE evil; --",
      host: '%',
    });
    // Quote must be escaped so SQL stays one string literal
    expect(r.sql[1]).toMatch(/IDENTIFIED BY 'x\\'; DROP DATABASE evil; --'/);
    expect(() =>
      renderMysqlProvisionSql({
        dbName: 'd1',
        username: 'u1',
        password: 'p',
        host: "'; DROP --",
      }),
    ).toThrow();
  });

  it('renderMysqlProvisionSql validates inputs before rendering', () => {
    expect(() =>
      renderMysqlProvisionSql({ dbName: 'bad-name', username: 'ok' }),
    ).toThrow();
    expect(() =>
      renderMysqlProvisionSql({ dbName: 'ok', username: 'bad-name' }),
    ).toThrow();
  });
});
