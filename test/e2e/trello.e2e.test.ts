import {expect} from 'chai'

import {closeTrelloBoard, RUN_ID, seedTrelloBoard} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type Card = {id: string; name: string}
type Comment = {data: {text: string}; id: string}

/**
 * The trello leg: the local `@hesed/trello` build, installed into the throwaway
 * home, driving the live account through the sdkck host binary.
 *
 * The CLI has no board-create command, so the fixture board (with To Do/Doing/
 * Done lists) is seeded via the REST API and closed again in after() — Trello
 * boards cannot be deleted, only closed.
 */
describe('e2e: trello plugin via sdkck', () => {
  let configDir: string
  let boardId: string
  let lists: {doing: string; todo: string}

  before(async () => {
    configDir = await createConfigDir('trello')
    const seeded = await seedTrelloBoard()
    boardId = seeded.boardId
    lists = {doing: seeded.lists.doing, todo: seeded.lists.todo}
  })

  after(async () => {
    try {
      if (boardId) await closeTrelloBoard(boardId)
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['trello', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test with a broken profile', async () => {
    const {code} = await runSdkck(['trello', 'auth', 'test', '--profile', 'broken'], configDir)
    expect(code).to.equal(2)
  })

  it('lists the seeded board', async () => {
    const payload = await runSdkckJson<{data: Array<{id: string; name: string}>; success: boolean}>(
      ['trello', 'board', 'list'],
      configDir,
    )
    expect(payload.success).to.be.true
    expect(payload.data.map((board) => board.id)).to.include(boardId)
  })

  it('drives a card through create, move, comment and delete', async () => {
    const name = `[e2e-host ${RUN_ID}] card`

    const created = await runSdkckJson<{data: {id: string}; success: boolean}>(
      ['trello', 'card', 'create', lists.todo, name],
      configDir,
    )
    expect(created.success).to.be.true
    const cardId = created.data.id

    const fetched = await runSdkckJson<{data: Card; success: boolean}>(['trello', 'card', cardId], configDir)
    expect(fetched.data.name).to.equal(name)

    const {code: moveCode} = await runSdkck(['trello', 'card', 'move', cardId, lists.doing], configDir)
    expect(moveCode).to.equal(0)

    const added = await runSdkckJson<{data: Comment; success: boolean}>(
      ['trello', 'comment', cardId, 'from the sdkck host e2e suite'],
      configDir,
    )
    expect(added.success).to.be.true

    const comments = await runSdkckJson<{data: Comment[]}>(['trello', 'card', 'comments', cardId], configDir)
    expect(comments.data.map((comment) => comment.id)).to.include(added.data.id)

    const {code: deleteCommentCode} = await runSdkck(['trello', 'comment', 'delete', cardId, added.data.id], configDir)
    expect(deleteCommentCode).to.equal(0)

    const {code: deleteCardCode} = await runSdkck(['trello', 'card', 'delete', cardId], configDir)
    expect(deleteCardCode).to.equal(0)

    const after = await runSdkckJson<{data: Card[]; success: boolean}>(['trello', 'board', 'cards', boardId], configDir)
    expect(after.data.map((card) => card.id)).to.not.include(cardId)
  })
})
