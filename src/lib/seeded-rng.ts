/**
 * Детерминированный генератор случайных чисел по строке-ключу. Локальные
 * движки-предпросмотры сеют его id записи: «Повторить» рисует ровно то же,
 * что и в первый раз.
 */
export type Rng = () => number

export function makeRng(seedText: string): Rng {
  let seed = 2166136261
  for (let i = 0; i < seedText.length; i += 1) {
    seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619)
  }
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
