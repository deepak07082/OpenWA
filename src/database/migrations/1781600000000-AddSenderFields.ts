import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds sender/session snapshot columns to `messages`:
 *   - senderPhone    varchar(30)  – digits-only phone of the sender
 *   - senderName     varchar(255) – pushName / display name of the sender
 *   - sessionPhone   varchar(30)  – session phone snapshotted at save time
 *   - sessionPushName varchar(255) – session WhatsApp display name at save time
 * All nullable so existing rows are unaffected.
 */
export class AddSenderFields1781600000000 implements MigrationInterface {
  name = 'AddSenderFields1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('messages', 'senderPhone'))) {
      await queryRunner.query(
        `ALTER TABLE "messages" ADD COLUMN "senderPhone" varchar(30)`,
      );
    }
    if (!(await queryRunner.hasColumn('messages', 'senderName'))) {
      await queryRunner.query(
        `ALTER TABLE "messages" ADD COLUMN "senderName" varchar(255)`,
      );
    }
    if (!(await queryRunner.hasColumn('messages', 'sessionPhone'))) {
      await queryRunner.query(
        `ALTER TABLE "messages" ADD COLUMN "sessionPhone" varchar(30)`,
      );
    }
    if (!(await queryRunner.hasColumn('messages', 'sessionPushName'))) {
      await queryRunner.query(
        `ALTER TABLE "messages" ADD COLUMN "sessionPushName" varchar(255)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['sessionPushName', 'sessionPhone', 'senderName', 'senderPhone']) {
      if (await queryRunner.hasColumn('messages', col)) {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "${col}"`);
      }
    }
  }
}
