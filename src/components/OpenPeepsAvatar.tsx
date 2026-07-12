import Peep, {
  Accessories,
  BustPose,
  Face,
  FacialHair,
  Hair,
} from 'react-peeps'

interface OpenPeepsAvatarData {
  accessory?: string
  body?: string
  face?: string
  hair?: string
  facialHair?: string
  backgroundColorIndex?: number
  flip?: boolean
}

const COFACTS_AVATAR_COLORS = [
  '#fb5959',
  '#ff7b7b',
  '#ff8a00',
  '#ffb600',
  '#ffea29',
  '#00b172',
  '#00d88b',
  '#4ff795',
  '#2079f0',
  '#2daef7',
  '#5fd8ff',
  '#966dee',
] as const

const DEFAULT_BG = '#ffea29'

const accessoryKeys = new Set(Object.keys(Accessories))
const bodyKeys = new Set(Object.keys(BustPose))
const faceKeys = new Set(Object.keys(Face))
const hairKeys = new Set(Object.keys(Hair))
const facialHairKeys = new Set(Object.keys(FacialHair))

function sanitize(raw: string | null): OpenPeepsAvatarData | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const data = parsed as Record<string, unknown>
  return {
    accessory:
      typeof data.accessory === 'string' && accessoryKeys.has(data.accessory)
        ? data.accessory
        : undefined,
    body:
      typeof data.body === 'string' && bodyKeys.has(data.body)
        ? data.body
        : undefined,
    face:
      typeof data.face === 'string' && faceKeys.has(data.face)
        ? data.face
        : undefined,
    hair:
      typeof data.hair === 'string' && hairKeys.has(data.hair)
        ? data.hair
        : undefined,
    facialHair:
      typeof data.facialHair === 'string' && facialHairKeys.has(data.facialHair)
        ? data.facialHair
        : undefined,
    backgroundColorIndex:
      typeof data.backgroundColorIndex === 'number'
        ? data.backgroundColorIndex
        : undefined,
    flip: typeof data.flip === 'boolean' ? data.flip : false,
  }
}

function getBackgroundColor(data: OpenPeepsAvatarData | null): string {
  if (!data || typeof data.backgroundColorIndex !== 'number') return DEFAULT_BG
  const idx = Math.floor(
    COFACTS_AVATAR_COLORS.length * data.backgroundColorIndex,
  )
  return (
    COFACTS_AVATAR_COLORS[
      Math.max(0, Math.min(COFACTS_AVATAR_COLORS.length - 1, idx))
    ] ?? DEFAULT_BG
  )
}

interface OpenPeepsAvatarProps {
  avatarData: string | null
  size: number
  name: string
  className?: string
}

export default function OpenPeepsAvatar({
  avatarData,
  size,
  name,
  className,
}: OpenPeepsAvatarProps) {
  const data = sanitize(avatarData)
  const bg = getBackgroundColor(data)
  const flip = data?.flip ?? false

  return (
    <div
      className={`rounded-full overflow-hidden flex items-center justify-center shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor: bg }}
      aria-label={name}
      title={name}
    >
      <div
        style={{
          width: size,
          height: size,
          transform: `${flip ? 'scaleX(-1)' : 'scaleX(1)'} translateY(${size / 15}px)`,
        }}
      >
        <Peep
          accessory={data?.accessory as never}
          body={data?.body as never}
          face={data?.face as never}
          facialHair={data?.facialHair as never}
          hair={data?.hair as never}
          strokeColor="#000"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}
