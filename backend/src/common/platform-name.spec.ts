import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVERY_PLATFORM_NAME, platformDisplayName } from './platform-name';

describe('a shop’s name as a person writes it', () => {
  it('writes each one the way it is written', () => {
    expect(platformDisplayName('AMAZON')).toBe('Amazon');
    expect(platformDisplayName('FLIPKART')).toBe('Flipkart');
    expect(platformDisplayName('INSTAMART')).toBe('Instamart');
  });

  it('answers null for anything it does not know, never the shouting form', () => {
    for (const unknown of [undefined, null, '', 'amazon', 'AMAZON_NEW', 'EBAY', 42]) {
      expect(platformDisplayName(unknown as never)).toBeNull();
    }
  });

  it('covers every shop in the schema’s own list, and no more', () => {
    // READ OUT OF THE SCHEMA, not typed here, so adding a shop to the enum and
    // forgetting to name it fails this instead of printing AMAZON_NEW at somebody.
    const schema = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8',
    );
    const block = /enum Platform \{([^}]*)\}/.exec(schema);
    expect(block).not.toBeNull();
    const inSchema = (block as RegExpExecArray)[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+$/.test(line));
    expect(inSchema.length).toBeGreaterThan(4);
    expect(Object.keys(EVERY_PLATFORM_NAME).sort()).toEqual([...inSchema].sort());
  });

  it('matches the names the device shows, which is what a person actually reads', () => {
    // The device's names live on the frozen platforms.js entries. Read as text: the
    // backend never loads that file, and this is the check that keeps the two from
    // drifting into saying different things about the same shop.
    const device = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'platforms.js'), 'utf8',
    );
    for (const written of Object.values(EVERY_PLATFORM_NAME)) {
      expect(device).toContain(`name: '${written}'`);
    }
  });
});
