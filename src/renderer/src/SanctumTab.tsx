import { useEffect, useState } from 'react'
import type { SessionState } from '@shared/api'
import type { LootValue, SanctumView } from '@shared/sanctum'
import { formatClock } from './format'

const number = (value: number, digits = 0): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function Access({ view, session }: { view: SanctumView; session: SessionState }) {
  const [account, setAccount] = useState(view.account)
  const [character, setCharacter] = useState(view.character)
  const [cookie, setCookie] = useState('')

  // The log already knows the character's name: offer it instead of making the player type it.
  useEffect(() => {
    if (!character && session.character) setCharacter(session.character.name)
  }, [character, session.character])

  const dirty = account.trim() !== view.account || character.trim() !== view.character || cookie.trim() !== ''

  return (
    <form
      className="side-block access"
      onSubmit={(e) => {
        e.preventDefault()
        void window.poe.sanctum.saveAccess({ account, character, cookie: cookie || undefined }).then(() => setCookie(''))
      }}
    >
      <h4>Доступ к инвентарю</h4>
      <p className="hint">
        Сайт Path of Exile показывает инвентарь только владельцу аккаунта, поэтому нужна cookie сессии. Она хранится
        зашифрованной средствами Windows и отправляется только на pathofexile.com.
      </p>
      <label className="field">
        <span>Аккаунт</span>
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Имя#1234" spellCheck={false} />
      </label>
      <label className="field">
        <span>Персонаж</span>
        <input value={character} onChange={(e) => setCharacter(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span>Cookie POESESSID</span>
        <input
          type="password"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder={view.cookieStored ? 'сохранена — вставь новую, чтобы заменить' : '32 символа из браузера'}
          autoComplete="off"
          spellCheck={false}
        />
        <small>
          В браузере на pathofexile.com: F12 → Application → Cookies → POESESSID. Никому её не передавай: это ключ от
          аккаунта.
        </small>
      </label>
      {!view.canStoreCookie && (
        <p className="note bad">Система не даёт зашифровать cookie, поэтому сохранить её не получится.</p>
      )}
      {view.status && <p className={view.status.ok ? 'note ok' : 'note bad'}>{view.status.message}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={view.busy || (!dirty && !view.cookieStored)}>
          {dirty ? 'Сохранить и проверить' : 'Проверить доступ'}
        </button>
        {view.cookieStored && (
          <button type="button" onClick={() => void window.poe.sanctum.clearCookie()}>
            Удалить cookie
          </button>
        )}
      </div>
    </form>
  )
}

export function LootTable({ loot }: { loot: LootValue }) {
  if (!loot.lines.length && !loot.gold) return <p className="empty">Ничего не прибавилось.</p>
  return (
    <>
      <p className="loot-total">
        <strong>{number(loot.chaos, 1)}</strong> хаосов
        {loot.divine != null && (
          <>
            {' '}
            · <strong>{number(loot.divine, 2)}</strong> дивайнов
          </>
        )}
        {loot.gold > 0 && <> · золото +{number(loot.gold)}</>}
      </p>
      <table className="items loot">
        <tbody>
          {loot.lines.map((line) => (
            <tr key={line.name}>
              <td>{line.name}</td>
              <td className="num">×{number(line.count)}</td>
              <td className="num muted">{line.chaos != null ? `${number(line.chaos, 1)} c` : 'без цены'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loot.unpriced > 0 && (
        <p className="hint">Позиций без цены: {loot.unpriced}. В суммы они не входят — пока оцениваю только валюту.</p>
      )}
    </>
  )
}

export function SanctumTab({ view, session }: { view: SanctumView; session: SessionState }) {
  return (
    <div className="plan">
      <aside className="plan-side">
        <Access view={view} session={session} />
      </aside>
      <div className="plan-main pob-view">
        <section>
          <h4>Проверка подсчёта лута</h4>
          <p className="hint">
            Сделай снимок, подбери что-нибудь в игре, перейди в другую зону (сайт обновляет персонажа при смене зоны)
            и сделай второй — ниже появится разница. Во время забегов это будет происходить само, на границах этажей.
          </p>
          <div className="actions">
            <button className="primary" disabled={view.busy || !view.cookieStored} onClick={() => void window.poe.sanctum.snapshot()}>
              {view.busy ? 'Запрашиваю…' : 'Снимок инвентаря'}
            </button>
          </div>
          {view.snapshots.length > 0 && (
            <p className="muted">
              Снимков: {view.snapshots.length}. Последний в {formatClock(view.snapshots[view.snapshots.length - 1].takenAt)}
              {view.snapshots[view.snapshots.length - 1].gold != null &&
                `, золото ${number(view.snapshots[view.snapshots.length - 1].gold!)}`}
              .
            </p>
          )}
        </section>

        {view.lastLoot && (
          <section>
            <h4>Прибавилось между двумя последними снимками</h4>
            <LootTable loot={view.lastLoot} />
          </section>
        )}

        <section>
          <h4>Цены</h4>
          {view.prices ? (
            <p className="muted">
              poe.ninja, лига {view.prices.league}, обновлены в {formatClock(view.prices.fetchedAt)}
              {view.prices.divineChaos != null && ` · Divine Orb = ${number(view.prices.divineChaos, 1)} хаосов`}.
            </p>
          ) : (
            <p className="muted">Загрузятся с poe.ninja при первом подсчёте.</p>
          )}
          {view.pricesError && <p className="note bad">Цены не обновились: {view.pricesError}</p>}
        </section>

        <p className="hint">
          Забеги, время этажей и статистика появятся следующим шагом — после распознавания забегов по логу.
        </p>
      </div>
    </div>
  )
}
