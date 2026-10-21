export interface OpenSession {
  id: string;
  drawId: string;
  drawName: string;
  drawDate: string;
  drawsAt: string;
  opensAt: string;
  closesAt: string;
  modalities: Array<{ digits: 2 | 3 | 4; minCents: string; stepCents: string; quotaPerNumberCents: string | null }>;
  plans: Array<{ id: string; digits: 2 | 3 | 4; name: string }>;
}

export interface ApiList<T> {
  items: T[];
}
