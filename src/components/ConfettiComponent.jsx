import { useWindowSize } from '@react-hook/window-size'
import Confetti from 'react-confetti'

const winnerColors = ['#f7d046', '#f28c28', '#f8f6ef', '#204d3b']
const loserColors = ['#121212', '#f2f2f2']
const drawColors = ['#2e73cf', '#d06e1e', '#f2f2f2', '#d6dde8']

function getStrokeColor(fillColor) {
  return fillColor === '#f2f2f2' || fillColor === '#d6dde8' ? '#1b2230' : '#f8fafc'
}

function drawWinnerWShape(ctx) {
  const size = Math.max((this.radius ?? 6) * 4.5, 30)
  const strokeColor = getStrokeColor(this.color)

  ctx.font = `900 ${size}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(size * 0.1, 2.6)
  ctx.strokeStyle = strokeColor
  ctx.strokeText('W', 0, 0)
  ctx.fillText('W', 0, 0)
}

function drawLoserLShape(ctx) {
  const size = Math.max((this.radius ?? 6) * 4.6, 30)
  const strokeColor = this.color === '#121212' ? '#f2f2f2' : '#121212'

  ctx.font = `900 ${size}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(size * 0.12, 2.8)
  ctx.strokeStyle = strokeColor
  ctx.strokeText('L', 0, 0)
  ctx.fillText('L', 0, 0)
}

function drawTieXOShape(ctx) {
  if (!this.tieGlyph) {
    this.tieGlyph = Math.random() < 0.5 ? 'X' : 'O'
  }

  const size = Math.max((this.radius ?? 6) * 3.8, 24)
  const strokeColor = getStrokeColor(this.color)

  ctx.font = `900 ${size}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(size * 0.1, 2.2)
  ctx.strokeStyle = strokeColor
  ctx.strokeText(this.tieGlyph, 0, 0)
  ctx.fillText(this.tieGlyph, 0, 0)
}

function ConfettiComponent({ active, mode = 'winner' }) {
  const [width, height] = useWindowSize()

  if (!active) {
    return null
  }

  const isLoserMode = mode === 'loser'
  const isDrawMode = mode === 'draw'

  return (
    <div className="confetti-layer" aria-hidden="true">
      <Confetti
        width={width}
        height={height}
        numberOfPieces={isLoserMode ? 220 : isDrawMode ? 260 : 320}
        recycle={false}
        gravity={isLoserMode ? 0.4 : isDrawMode ? 0.34 : 0.3}
        initialVelocityY={isLoserMode ? 10 : isDrawMode ? 12 : 15}
        colors={isLoserMode ? loserColors : isDrawMode ? drawColors : winnerColors}
        drawShape={
          isLoserMode
            ? drawLoserLShape
            : isDrawMode
              ? drawTieXOShape
              : drawWinnerWShape
        }
      />
    </div>
  )
}

export default ConfettiComponent
