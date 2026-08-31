import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Campaign, CampaignCheckRun } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOADS_URL_PREFIX } from '../storage/storage.service';
import { claimedSeatsByCampaign, claimedFor } from '../campaigns/seats';
import { resolveChargedPaise } from '../tasks/engine/charged-amount';
import { toEngineTask } from '../tasks/task.mapper';
import {
  checkCampaign,
  SEVERITY_ORDER,
  type CampaignFacts,
  type Finding,
  type ImageFacts,
  type Severity,
} from './campaign-health.rules';

/** One offer and everything the check has to say about it. */
export interface OfferFindings {
  campaignId: string;
  title: string;
  platform: string;
  findings: Finding[];
}

/**
 * Something the check could NOT establish, said once and listing every offer it
 * applies to.
 *
 * Why grouped: eleven of thirteen live offers have no product-page link, so the
 * same "nobody can tell whether the picture is right" note applied to every one of
 * them. Printed per offer that is twenty-odd identical lines burying the one real
 * problem — which is exactly how a team learns to close the tab. The honesty is in
 * saying it at all, not in saying it eleven times.
 */
export interface HealthLimit {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  offers: { campaignId: string; title: string }[];
}

export interface HealthReport {
  ranAt: Date;
  /** How many live offers were looked at — not how many had something wrong. */
  checked: number;
  counts: Record<Severity, number>;
  /** Offers with something WRONG and exceptional. An empty list is the good outcome. */
  offers: OfferFindings[];
  /** What could not be checked, grouped by reason. Never a pass. */
  limits: HealthLimit[];
  /**
   * Findings on MOST of the live catalogue. A problem on twelve of thirteen offers
   * is a policy question, not a to-do list, and repeating it per offer buries the
   * one offer that is genuinely broken.
   */
  patterns: HealthLimit[];
}

/** More than this share of live offers makes a finding a pattern, not a defect. */
export const PATTERN_SHARE = 0.5;

/** A finding identified across runs: which offer, which rule. */
export interface FindingKey {
  campaignId: string;
  title: string;
  code: string;
  severity: Severity;
}

/** The first bytes of the image formats a browser will actually render. */
const IMAGE_SIGNATURES: [string, number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
  // WebP is "RIFF....WEBP" — the RIFF header alone is not enough.
  ['webp', [0x52, 0x49, 0x46, 0x46]],
];

/**
 * THE DAILY CHECK — the part that reads the world.
 *
 * The rules live next door and know nothing about a database or a disk, which is
 * why they can be tested at every boundary. This gathers what they need: the live
 * offers, how many seats are taken, whether each picture file is actually there
 * and actually a picture, and what people really paid.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: go out to the marketplaces. Nothing here
 * fetches an Amazon or Flipkart page. That is not a shortcut — the on-device
 * scraper owns every marketplace read, under a session that belongs to a real
 * user, and a nightly server job pulling product pages would be a second route to
 * the same facts with none of the same authority. So "is this picture the right
 * product" and "is this price still current" come back as unchecked, with the
 * reason, and that is the honest answer rather than a gap to be filled quietly.
 */
@Injectable()
export class CampaignHealthService {
  private readonly logger = new Logger(CampaignHealthService.name);
  private readonly uploadRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.uploadRoot = resolve(config.get('UPLOAD_DIR', { infer: true }));
  }

  /** Run every rule over every live offer. Reads only; writes nothing. */
  async run(): Promise<HealthReport> {
    const live = await this.prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    const seats = await claimedSeatsByCampaign(
      this.prisma,
      live.map((c) => c.id),
    );
    const sharedPictures = groupByPicture(live);
    const charged = await this.chargedByCampaign(live.map((c) => c.id));

    const offers: OfferFindings[] = [];
    const counts: Record<Severity, number> = {
      blocking: 0,
      attention: 0,
      unchecked: 0,
    };
    const limits = new Map<string, HealthLimit>();
    // Every defect grouped by rule, so a rule that fires on most of the catalogue
    // can be recognised as a pattern before anything is printed per offer.
    const byCode = new Map<string, HealthLimit>();
    const perOffer = new Map<string, { campaign: Campaign; findings: Finding[] }>();

    for (const c of live) {
      const facts: CampaignFacts = {
        id: c.id,
        title: c.title,
        productName: c.productName,
        platform: c.platform,
        status: c.status,
        category: c.category,
        productPricePaise: c.productPricePaise,
        payoutPercent: c.payoutPercent,
        payoutCapPaise: c.payoutCapPaise,
        returnWindowDays: c.returnWindowDays,
        totalSlots: c.totalSlots,
        claimedCount: claimedFor(seats, c.id),
        terms: c.terms,
        productUrl: c.productUrl,
        imageUrl: c.imageUrl,
        image: await this.imageFacts(c, sharedPictures),
        chargedSamples: charged.get(c.id) ?? [],
      };
      const findings = checkCampaign(facts);
      for (const f of findings) counts[f.severity] += 1;
      for (const f of findings) {
        const bucket = f.severity === 'unchecked' ? limits : byCode;
        // The group's own wording when the rule supplies one — a heading over ten
        // offers must not say "this offer", and must not carry one offer's price.
        const group = bucket.get(f.code) ?? {
          code: f.code,
          severity: f.severity,
          title: f.group?.title ?? f.title,
          detail: f.group?.detail ?? f.detail,
          offers: [],
        };
        group.offers.push({ campaignId: c.id, title: c.title });
        bucket.set(f.code, group);
      }
      perOffer.set(c.id, { campaign: c, findings });
    }

    // A finding on most of the catalogue is lifted out. Nothing is dropped — the
    // pattern carries the same words and the full list of offers — but it stops
    // repeating down a page where one offer's real problem has to be visible.
    const threshold = live.length * PATTERN_SHARE;
    const patternCodes = new Set(
      [...byCode.values()]
        .filter((g) => g.offers.length > threshold)
        .map((g) => g.code),
    );

    for (const { campaign, findings } of perOffer.values()) {
      const defects = findings.filter(
        (f) => f.severity !== 'unchecked' && !patternCodes.has(f.code),
      );
      if (defects.length === 0) continue;
      offers.push({
        campaignId: campaign.id,
        title: campaign.title,
        platform: campaign.platform,
        findings: defects,
      });
    }

    // Worst offers first, so a long report still reads top-down.
    offers.sort((a, b) => worst(a.findings) - worst(b.findings));

    const byCount = (a: HealthLimit, b: HealthLimit): number =>
      b.offers.length - a.offers.length;
    return {
      ranAt: new Date(),
      checked: live.length,
      counts,
      offers,
      limits: [...limits.values()].sort(byCount),
      patterns: [...byCode.values()]
        .filter((g) => patternCodes.has(g.code))
        .sort(byCount),
    };
  }

  /** Keep the run, so it can be proved it happened and compared against. */
  async record(
    trigger: 'SCHEDULED' | 'MANUAL',
    report: HealthReport,
  ): Promise<CampaignCheckRun> {
    return this.prisma.campaignCheckRun.create({
      data: {
        ranAt: report.ranAt,
        trigger,
        checked: report.checked,
        blocking: report.counts.blocking,
        attention: report.counts.attention,
        unchecked: report.counts.unchecked,
        findings: keysOf(report) as unknown as object,
      },
    });
  }

  latestRun(): Promise<CampaignCheckRun | null> {
    return this.prisma.campaignCheckRun.findFirst({
      orderBy: { ranAt: 'desc' },
    });
  }

  /**
   * What is in this report and was not in the last recorded run.
   *
   * With no previous run the answer is an empty list, not the whole report. On the
   * first night everything is technically new, and presenting a full catalogue as
   * "new since last night" would be the report's first lie.
   */
  newSince(
    report: HealthReport,
    previous: CampaignCheckRun | null,
  ): FindingKey[] {
    if (!previous) return [];
    const before = new Set(
      (previous.findings as unknown as FindingKey[] | null ?? []).map(
        (f) => `${f.campaignId}:${f.code}`,
      ),
    );
    return keysOf(report).filter(
      (f) => !before.has(`${f.campaignId}:${f.code}`),
    );
  }

  /** Run it, keep it, and log a one-line summary. Used by the nightly job. */
  async runAndRecord(
    trigger: 'SCHEDULED' | 'MANUAL',
  ): Promise<{ report: HealthReport; fresh: FindingKey[] }> {
    const previous = await this.latestRun();
    const report = await this.run();
    const fresh = this.newSince(report, previous);
    await this.record(trigger, report);
    this.logger.log(
      `${trigger.toLowerCase()} check: ${report.checked} live offers, `
        + `${report.counts.blocking} blocking, ${report.counts.attention} to look at, `
        + `${report.counts.unchecked} not checkable, ${fresh.length} new`,
    );
    return { report, fresh };
  }

  // ── gathering ─────────────────────────────────────────────────────────────

  /**
   * What people really paid on each offer, one figure per order, resolved by the
   * SAME function the refund gate uses. Anything that function refuses to price
   * (a basket total with no line, a missing figure) is left out rather than
   * guessed — an offer with nothing priceable simply has no evidence either way.
   */
  private async chargedByCampaign(
    campaignIds: string[],
  ): Promise<Map<string, bigint[]>> {
    const out = new Map<string, bigint[]>();
    if (campaignIds.length === 0) return out;
    const tasks = await this.prisma.task.findMany({
      where: { campaignId: { in: campaignIds }, orderId: { not: null } },
    });
    for (const t of tasks) {
      const engine = toEngineTask(t, []);
      const resolved = resolveChargedPaise(engine.order);
      if (resolved.paise == null) continue;
      const list = out.get(t.campaignId) ?? [];
      list.push(resolved.paise);
      out.set(t.campaignId, list);
    }
    return out;
  }

  /** Is the picture file there, is it a picture, and is another offer using it? */
  private async imageFacts(
    c: Campaign,
    shared: Map<string, string[]>,
  ): Promise<ImageFacts> {
    const url = (c.imageUrl ?? '').trim();
    if (url === '') return { kind: 'none' };
    if (/^https?:\/\//i.test(url)) return { kind: 'remote' };
    if (!url.startsWith(`${UPLOADS_URL_PREFIX}/`)) return { kind: 'remote' };

    const relative = url.slice(UPLOADS_URL_PREFIX.length + 1);
    // Never let a stored path climb out of the upload directory. A column is not
    // a trusted input just because staff wrote it.
    const path = resolve(join(this.uploadRoot, relative));
    const sharedWith = (shared.get(url) ?? []).filter((t) => t !== c.title);
    if (!path.startsWith(this.uploadRoot)) {
      return { kind: 'local-file', exists: false, looksLikeImage: false, sharedWith };
    }

    try {
      const info = await stat(path);
      if (!info.isFile()) {
        return { kind: 'local-file', exists: false, looksLikeImage: false, sharedWith };
      }
      const head = await readFile(path);
      return {
        kind: 'local-file',
        exists: true,
        looksLikeImage: looksLikeImage(head),
        sharedWith,
      };
    } catch {
      return { kind: 'local-file', exists: false, looksLikeImage: false, sharedWith };
    }
  }
}

function looksLikeImage(bytes: Buffer): boolean {
  for (const [kind, sig] of IMAGE_SIGNATURES) {
    if (bytes.length < sig.length) continue;
    if (sig.every((b, i) => bytes[i] === b)) {
      if (kind !== 'webp') return true;
      // RIFF alone is a container; the WEBP tag at offset 8 is what makes it one.
      return bytes.length >= 12 && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    }
  }
  return false;
}

/** picture URL → titles of every live offer using it. */
function groupByPicture(live: Campaign[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of live) {
    const url = (c.imageUrl ?? '').trim();
    if (url === '') continue;
    out.set(url, [...(out.get(url) ?? []), c.title]);
  }
  return out;
}

const worst = (findings: Finding[]): number =>
  Math.min(...findings.map((f) => SEVERITY_ORDER.indexOf(f.severity)));

/**
 * Every finding in a report, flattened to (offer, rule) pairs — the grouped
 * limits included. Grouping is a presentation choice; leaving them out here would
 * mean a newly-added offer that cannot be checked never showed up as new.
 */
const keysOf = (report: HealthReport): FindingKey[] => [
  ...report.offers.flatMap((o) =>
    o.findings.map((f) => ({
      campaignId: o.campaignId,
      title: o.title,
      code: f.code,
      severity: f.severity,
    })),
  ),
  ...[...report.limits, ...report.patterns].flatMap((l) =>
    l.offers.map((o) => ({
      campaignId: o.campaignId,
      title: o.title,
      code: l.code,
      severity: l.severity,
    })),
  ),
];
