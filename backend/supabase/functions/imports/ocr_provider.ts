import { BusinessError } from '../_shared/errors.ts';

export interface NormalizedOcrField {
  key: string;
  rawValue: unknown;
  confidence: number | null;
  page: number | null;
  region?: Record<string, unknown>;
}

export interface NormalizedOcrResult {
  provider: string;
  status: 'disabled' | 'completed' | 'failed';
  rawText: string | null;
  fields: NormalizedOcrField[];
  confidence: number | null;
  metadata: Record<string, unknown>;
}

export interface OcrProvider {
  name: string;
  isEnabled(): boolean;
  extract(input?: {
    fileName: string;
    fileType: 'pdf' | 'image';
    detectedMime: string;
    bytes: ArrayBuffer;
  }): Promise<NormalizedOcrResult>;
}

export class DisabledOcrProvider implements OcrProvider {
  readonly name = 'disabled_manual_fallback';

  isEnabled(): boolean {
    return false;
  }

  async extract(): Promise<NormalizedOcrResult> {
    return {
      provider: this.name,
      status: 'disabled',
      rawText: null,
      fields: [],
      confidence: null,
      metadata: {
        manual_fallback: true,
        message: 'OCR provider is disabled. Use manual review/draft intake.',
      },
    };
  }
}

export function getOcrProvider(): OcrProvider {
  const enabled = Deno.env.get('OCR_PROVIDER_ENABLED') === 'true';
  const providerName = Deno.env.get('OCR_PROVIDER')?.trim();

  if (!enabled || !providerName) {
    return new DisabledOcrProvider();
  }

  throw new BusinessError(
    'OCR_PROVIDER_NOT_CONFIGURED',
    'OCR provider activation requires a separately approved provider implementation.',
    503,
    { provider: providerName },
  );
}
