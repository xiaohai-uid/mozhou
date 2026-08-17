export const PROVIDER_SOURCE_CLASSES = [
  "PUBLIC_FREE",
  "PLATFORM_PAID",
  "USER_BYOK",
  "TEST_MOCK",
] as const;

export type ProviderSourceClass = (typeof PROVIDER_SOURCE_CLASSES)[number];
export type ProviderOwner = "platform" | "provider" | "user" | "none";
export type ProviderRoute = "chat" | "chapter" | "distill" | "draw" | "deconstruct";

export type ProviderBoundary = {
  route: ProviderRoute;
  sourceClass: ProviderSourceClass;
  provider: "one-api" | "test-mock";
  model: string;
  credentialOwner: ProviderOwner;
  billingOwner: ProviderOwner;
};

export type ProviderCandidate = {
  id: string;
  sourceClass: ProviderSourceClass;
};

export type ProviderAttemptOutcome = {
  sourceClass: ProviderSourceClass;
  status: "succeeded" | "failed";
  code?: string | null;
};

export type ProviderRequestOutcome =
  | { status: "succeeded" }
  | { status: "failed"; code: "FREE_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | string };

type ProviderBoundaryInput = {
  route: ProviderRoute;
  model: string;
  env?: NodeJS.ProcessEnv;
};

export class ProviderBoundaryError extends Error {
  constructor(
    readonly code: "TEST_MOCK_FORBIDDEN" | "FREE_UNAVAILABLE" | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE",
    message: string,
    readonly status?: number,
  ) {
    super(`${code}: ${message}`);
    this.name = "ProviderBoundaryError";
  }
}

function envPrefix(route: ProviderRoute): "CHAT" | "DISTILL" | "DRAW" | "DECONSTRUCT" {
  if (route === "chat" || route === "chapter") return "CHAT";
  return route.toUpperCase() as "DISTILL" | "DRAW" | "DECONSTRUCT";
}

function parseSourceClass(value: string | undefined): ProviderSourceClass | undefined {
  return PROVIDER_SOURCE_CLASSES.includes(value as ProviderSourceClass)
    ? value as ProviderSourceClass
    : undefined;
}

/**
 * Resolves source/credential/billing identity before any provider adapter is constructed.
 * The gateway token is deliberately not used to infer any of these identities.
 */
export function resolveProviderBoundary(input: ProviderBoundaryInput): ProviderBoundary {
  const env = input.env ?? process.env;
  const prefix = envPrefix(input.route);
  const selector = env[`${prefix}_PROVIDER`] ?? "one-api";
  const configuredClass = env[`${prefix}_SOURCE_CLASS`];
  const sourceClass = parseSourceClass(configuredClass) ?? (selector === "mock" ? "TEST_MOCK" : "PUBLIC_FREE");

  if (configuredClass && !parseSourceClass(configuredClass)) {
    throw new ProviderBoundaryError(
      "PROVIDER_NOT_CONFIGURED",
      `${prefix}_SOURCE_CLASS 必须是 ${PROVIDER_SOURCE_CLASSES.join(" / ")}`,
    );
  }

  if (selector === "mock" && sourceClass !== "TEST_MOCK") {
    throw new ProviderBoundaryError(
      "PROVIDER_NOT_CONFIGURED",
      `${prefix}_PROVIDER=mock 必须显式声明 source class TEST_MOCK`,
    );
  }

  if (sourceClass === "TEST_MOCK") {
    if (env.NODE_ENV === "production") {
      throw new ProviderBoundaryError(
        "TEST_MOCK_FORBIDDEN",
        "生产环境禁止使用 TEST_MOCK",
        500,
      );
    }
    return {
      route: input.route,
      sourceClass,
      provider: "test-mock",
      model: input.model,
      credentialOwner: "none",
      billingOwner: "none",
    };
  }

  if (sourceClass !== "PUBLIC_FREE") {
    throw new ProviderBoundaryError(
      "PROVIDER_NOT_CONFIGURED",
      `${sourceClass} 尚未配置独立 credential/provider boundary`,
      503,
    );
  }

  return {
    route: input.route,
    sourceClass,
    provider: "one-api",
    model: input.model,
    credentialOwner: "platform",
    billingOwner: "provider",
  };
}

/**
 * Fallback is a policy decision, not an adapter-side guess. A source class may
 * only consume candidates from that same class; a failed public-free route is
 * explicit FREE_UNAVAILABLE rather than silently becoming paid or BYOK.
 */
export function selectSameClassFallback(
  primary: ProviderBoundary,
  candidates: ProviderCandidate[],
): ProviderCandidate {
  const sameClass = candidates.find((candidate) => candidate.sourceClass === primary.sourceClass);
  if (sameClass) return sameClass;
  if (primary.sourceClass === "PUBLIC_FREE") {
    throw new ProviderBoundaryError(
      "FREE_UNAVAILABLE",
      "公益模型不可用，禁止跨 source class fallback",
      503,
    );
  }
  throw new ProviderBoundaryError(
    "PROVIDER_UNAVAILABLE",
    `${primary.sourceClass} 没有可用的同类 fallback`,
    503,
  );
}

/**
 * Collapses attempt-level outcomes into the request terminal outcome without
 * losing the source-class invariant. A provider/network code describes one
 * attempt; only an exhausted PUBLIC_FREE request becomes FREE_UNAVAILABLE.
 */
export function resolveProviderRequestOutcome(
  primary: ProviderBoundary,
  attempts: ProviderAttemptOutcome[],
  options: { exhausted: boolean },
): ProviderRequestOutcome {
  for (const attempt of attempts) {
    if (attempt.sourceClass !== primary.sourceClass) {
      throw new ProviderBoundaryError(
        primary.sourceClass === "PUBLIC_FREE" ? "FREE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE",
        "provider attempt 不得跨 source class",
        503,
      );
    }
  }
  if (attempts.some((attempt) => attempt.status === "succeeded")) {
    return { status: "succeeded" };
  }
  if (!options.exhausted) {
    const lastCode = attempts.at(-1)?.code;
    return {
      status: "failed",
      code: lastCode ?? (primary.sourceClass === "PUBLIC_FREE" ? "FREE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE"),
    };
  }
  return {
    status: "failed",
    code: primary.sourceClass === "PUBLIC_FREE" ? "FREE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE",
  };
}
