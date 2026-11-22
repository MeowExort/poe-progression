import { useState } from 'react'
import { STYLES, type Answers, type Style } from '@shared/plan'
import { PRIORITY_LABELS, STYLE_LABELS } from './labels'

const EMPTY: Answers = { liked: [], avoided: [], priority: 'balance', buttons: 'any', farmUniques: false }

function toggle(list: Style[], style: Style): Style[] {
  return list.includes(style) ? list.filter((s) => s !== style) : [...list, style]
}

export function Questionnaire({
  initial,
  onDone,
  onCancel
}: {
  initial: Answers | null
  onDone: () => void
  onCancel?: () => void
}) {
  const [answers, setAnswers] = useState<Answers>(initial ?? EMPTY)
  const set = (patch: Partial<Answers>): void => setAnswers((current) => ({ ...current, ...patch }))

  return (
    <form
      className="questionnaire"
      onSubmit={(e) => {
        e.preventDefault()
        void window.poe.plan.setAnswers(answers).then(onDone)
      }}
    >
      <p className="hint">Пять вопросов — по ответам я отсортирую стартовые билды для SSF.</p>

      <fieldset>
        <legend>Чем хочется играть?</legend>
        <small>Можно выбрать несколько или ничего, если всё равно.</small>
        <div className="chips">
          {STYLES.map((style) => (
            <button
              type="button"
              key={style}
              className={answers.liked.includes(style) ? 'chip on' : 'chip'}
              onClick={() =>
                set({ liked: toggle(answers.liked, style), avoided: answers.avoided.filter((s) => s !== style) })
              }
            >
              {STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Чем точно не хочется?</legend>
        <div className="chips">
          {STYLES.map((style) => (
            <button
              type="button"
              key={style}
              className={answers.avoided.includes(style) ? 'chip off' : 'chip'}
              onClick={() =>
                set({ avoided: toggle(answers.avoided, style), liked: answers.liked.filter((s) => s !== style) })
              }
            >
              {STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Что важнее всего?</legend>
        <div className="chips">
          {(Object.keys(PRIORITY_LABELS) as Answers['priority'][]).map((priority) => (
            <button
              type="button"
              key={priority}
              className={answers.priority === priority ? 'chip on' : 'chip'}
              onClick={() => set({ priority })}
            >
              {PRIORITY_LABELS[priority]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Сколько кнопок готов жать?</legend>
        <div className="chips">
          <button type="button" className={answers.buttons === 'few' ? 'chip on' : 'chip'} onClick={() => set({ buttons: 'few' })}>
            Чем меньше, тем лучше
          </button>
          <button type="button" className={answers.buttons === 'any' ? 'chip on' : 'chip'} onClick={() => set({ buttons: 'any' })}>
            Не важно
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Готов целенаправленно фармить конкретный уник под билд?</legend>
        <small>В SSF его нельзя купить: пока уник не выпал, билд не работает.</small>
        <div className="chips">
          <button type="button" className={answers.farmUniques ? 'chip on' : 'chip'} onClick={() => set({ farmUniques: true })}>
            Да
          </button>
          <button type="button" className={!answers.farmUniques ? 'chip on' : 'chip'} onClick={() => set({ farmUniques: false })}>
            Нет, только билды без обязательных уников
          </button>
        </div>
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary">
          Подобрать билды
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  )
}
