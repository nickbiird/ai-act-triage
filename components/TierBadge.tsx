const STYLES: Record<string, string> = {
  prohibited: 'bg-red-100 text-red-800 border-red-300',
  high_risk: 'bg-orange-100 text-orange-800 border-orange-300',
  limited: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  minimal: 'bg-green-100 text-green-800 border-green-300',
};

const NAMES: Record<string, string> = {
  prohibited: 'Prohibited',
  high_risk: 'High-risk',
  limited: 'Limited risk',
  minimal: 'Minimal risk',
};

export function TierBadge({ tier, large }: { tier: string; large?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full border font-medium ${STYLES[tier] ?? 'bg-stone-100 text-stone-700 border-stone-300'} ${
        large ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      {NAMES[tier] ?? tier}
    </span>
  );
}
