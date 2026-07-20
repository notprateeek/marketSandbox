import {
  AccountStatus,
  LedgerEntryType,
  SimulationStatus,
  type PrismaClient,
  type ScenarioPack,
} from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { captureSnapshot } from '@/server/services/portfolio-snapshot';

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}

export interface ScenarioCheckpoint {
  timestamp: Date;
  title: string;
  body: string;
}

export interface ScenarioPackView {
  id: string;
  slug: string;
  title: string;
  description: string;
  startTimestamp: Date;
  endTimestamp: Date;
  startingBalancePaise: bigint;
  instrumentIds: string[];
  checkpoints: ScenarioCheckpoint[];
}

export function listScenarioPacks(database: PrismaClient = prisma) {
  return database.scenarioPack
    .findMany({ orderBy: { startTimestamp: 'asc' } })
    .then((packs) => packs.map(toView));
}

export async function loadScenarioPack(
  slug: string,
  database: PrismaClient = prisma,
): Promise<ScenarioPackView | null> {
  const pack = await database.scenarioPack.findUnique({ where: { slug } });
  return pack ? toView(pack) : null;
}

export async function loadScenarioForSession(
  scenarioPackId: string | null,
  database: PrismaClient = prisma,
): Promise<ScenarioPackView | null> {
  if (!scenarioPackId) return null;
  const pack = await database.scenarioPack.findUnique({ where: { id: scenarioPackId } });
  return pack ? toView(pack) : null;
}

/**
 * Starts a curated scenario as an ordinary simulation pinned to the pack's
 * window — same engine, same order/valuation code — tagged with the pack so the
 * cockpit can surface its checkpoints and the analytics view can frame a debrief.
 */
export async function startScenario(
  params: { userId: string; slug: string },
  database: PrismaClient = prisma,
) {
  const pack = await database.scenarioPack.findUnique({ where: { slug: params.slug } });
  if (!pack) throw new ScenarioError('Scenario not found.');

  const session = await database.$transaction(async (transaction) => {
    const account = await transaction.virtualAccount.create({
      data: {
        userId: params.userId,
        name: `Scenario · ${pack.title}`,
        startingBalancePaise: pack.startingBalancePaise,
        availableCashPaise: pack.startingBalancePaise,
        status: AccountStatus.ACTIVE,
        ledgerEntries: {
          create: {
            type: LedgerEntryType.INITIAL_CREDIT,
            amountPaise: pack.startingBalancePaise,
            balanceAfterPaise: pack.startingBalancePaise,
            referenceType: 'SYSTEM',
            referenceId: 'ACCOUNT_OPENING',
            description: 'Initial scenario cash credit',
          },
        },
      },
    });

    return transaction.simulationSession.create({
      data: {
        userId: params.userId,
        virtualAccountId: account.id,
        name: pack.title,
        startTimestamp: pack.startTimestamp,
        currentTimestamp: pack.startTimestamp,
        endTimestamp: pack.endTimestamp,
        initialBalancePaise: pack.startingBalancePaise,
        status: SimulationStatus.ACTIVE,
        scenarioPackId: pack.id,
      },
    });
  });

  await captureSnapshot(
    { virtualAccountId: session.virtualAccountId, simulationSessionId: session.id },
    session.startTimestamp,
    database,
  );
  return session;
}

/**
 * The checkpoint whose narrative should be showing at `clock`: the latest one
 * the clock has reached. Pure. Returns null before the first checkpoint.
 */
export function checkpointAt(
  checkpoints: ScenarioCheckpoint[],
  clock: Date,
): ScenarioCheckpoint | null {
  const reached = checkpoints
    .filter((checkpoint) => checkpoint.timestamp.getTime() <= clock.getTime())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return reached.at(-1) ?? null;
}

function toView(pack: ScenarioPack): ScenarioPackView {
  return {
    id: pack.id,
    slug: pack.slug,
    title: pack.title,
    description: pack.description,
    startTimestamp: pack.startTimestamp,
    endTimestamp: pack.endTimestamp,
    startingBalancePaise: pack.startingBalancePaise,
    instrumentIds: parseStringArray(pack.instrumentIds),
    checkpoints: parseCheckpoints(pack.checkpoints),
  };
}

function parseStringArray(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseCheckpoints(json: string): ScenarioCheckpoint[] {
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => ({
        timestamp: new Date(entry?.timestamp),
        title: String(entry?.title ?? ''),
        body: String(entry?.body ?? ''),
      }))
      .filter((checkpoint) => !Number.isNaN(checkpoint.timestamp.getTime()))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  } catch {
    return [];
  }
}
