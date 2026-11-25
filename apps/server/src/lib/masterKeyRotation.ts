import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../db/types.js';
import { decryptSecret, encryptSecret, type EncryptedEnvelope } from './crypto.js';

function envelopeFromJson(raw: string): EncryptedEnvelope {
  const parsed = JSON.parse(raw) as Partial<EncryptedEnvelope>;
  if (
    !parsed.encryptedDek ||
    !parsed.encryptedValue ||
    !parsed.dekIv ||
    !parsed.dekTag ||
    !parsed.valueIv ||
    !parsed.valueTag
  ) {
    throw new Error('invalid envelope');
  }
  return parsed as EncryptedEnvelope;
}

export interface RotationStats {
  credentials: number;
  keypairs: number;
  totp: number;
}

/** 用新 KEK 重新包裹所有信封密文；任一条解密失败则整体回滚 */
export async function rotateMasterKey(
  db: Kysely<DatabaseSchema>,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<RotationStats> {
  const stats: RotationStats = { credentials: 0, keypairs: 0, totp: 0 };
  await db.transaction().execute(async (trx) => {
    const credentials = await trx.selectFrom('credentials').selectAll().execute();
    for (const row of credentials) {
      const value = decryptSecret(
        {
          encryptedDek: row.encrypted_dek,
          encryptedValue: row.encrypted_value,
          dekIv: row.dek_iv,
          dekTag: row.dek_tag,
          valueIv: row.value_iv,
          valueTag: row.value_tag,
        },
        oldKey,
      );
      const env = encryptSecret(value, newKey);
      await trx
        .updateTable('credentials')
        .set({
          encrypted_dek: env.encryptedDek,
          encrypted_value: env.encryptedValue,
          dek_iv: env.dekIv,
          dek_tag: env.dekTag,
          value_iv: env.valueIv,
          value_tag: env.valueTag,
        })
        .where('id', '=', row.id)
        .execute();
      stats.credentials += 1;
    }

    const keypairs = await trx.selectFrom('keypairs').selectAll().execute();
    for (const row of keypairs) {
      if (!row.encrypted_private_key) continue;
      const privateKey = decryptSecret(envelopeFromJson(row.encrypted_private_key), oldKey);
      await trx
        .updateTable('keypairs')
        .set({ encrypted_private_key: JSON.stringify(encryptSecret(privateKey, newKey)) })
        .where('id', '=', row.id)
        .execute();
      stats.keypairs += 1;
    }

    const users = await trx.selectFrom('users').selectAll().execute();
    for (const row of users) {
      if (!row.totp_secret_enc) continue;
      const secret = decryptSecret(envelopeFromJson(row.totp_secret_enc), oldKey);
      await trx
        .updateTable('users')
        .set({ totp_secret_enc: JSON.stringify(encryptSecret(secret, newKey)) })
        .where('id', '=', row.id)
        .execute();
      stats.totp += 1;
    }
  });
  return stats;
}
