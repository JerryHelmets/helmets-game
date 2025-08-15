export function scoreEmojis(total: number): string {
  if (total < 100) return '🫵🤣🫵';
  if (total < 200) return '💩';
  if (total < 300) return '🤡';
  if (total < 400) return '😐';
  if (total < 500) return '🤢';
  if (total < 600) return '😌';
  if (total < 700) return '👊';
  if (total < 800) return '👀';
  if (total < 900) return '👏';
  if (total < 1000) return '📈';
  if (total < 1100) return '🔥';
  if (total < 1200) return '🎯';
  if (total < 1300) return '🥇';
  if (total < 1400) return '🚀';
  return '🏆';
}

export function buildShareText(title: string, squares: string, score: number, emoji: string) {
  return `${title}

${squares}
Score: ${score} ${emoji}

www.helmets-game.com`;
}
