'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')

describe('Basic Publishing', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

  before(done => {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => done())
  })

  before(function() {
    hub = Hub({
      timeout: 500,
      logLevel: 'debug',
      mongo: {
        url: mongoInMemory.getMongouri('hub')
      }
    })
    return hub.listen()
  })

  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => done())
    })
  })

  it('Should not be able to publish because topic endpoint does not respond with success code', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const blogFeeds = {
      version: 'https://jsonfeed.org/version/1',
      title: 'My Example Feed',
      updated: '2003-12-13T18:30:02Z',
      home_page_url: 'https://example.org/',
      feed_url: 'https://example.org/feed.json',
      items: [
        {
          id: '2',
          content_text: 'This is a second item.',
          url: 'https://example.org/second-item'
        },
        {
          id: '1',
          content_html: '<p>Hello, world!</p>',
          url: 'https://example.org/initial-post'
        }
      ]
    }
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [
          200,
          { ...createSubscriptionBody, 'hub.challenge': query['hub.challenge'] }
        ]
      })

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .query(true)
      .reply(404)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    try {
      response = await Got.post(`http://localhost:${PORT}/publish`, {
        form: true,
        body: {
          'hub.mode': 'publish',
          'hub.url': topic + '/feeds'
        }
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(404)
    }

    verifyIntentMock.done()
    topicContentMock.done()
  })

  it('Should be able to publish to topic and distribute content to subscribers', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const blogFeeds = {
      version: 'https://jsonfeed.org/version/1',
      title: 'My Example Feed',
      updated: '2003-12-13T18:30:02Z',
      home_page_url: 'https://example.org/',
      feed_url: 'https://example.org/feed.json',
      items: [
        {
          id: '2',
          content_text: 'This is a second item.',
          url: 'https://example.org/second-item'
        },
        {
          id: '1',
          content_html: '<p>Hello, world!</p>',
          url: 'https://example.org/initial-post'
        }
      ]
    }
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [
          200,
          { ...createSubscriptionBody, 'hub.challenge': query['hub.challenge'] }
        ]
      })

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .query(true)
      .reply(200, blogFeeds)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    const verifyPublishedContentMock = Nock(callbackUrl)
      .post('/')
      .query(true)
      .reply(function(uri, requestBody) {
        expect(this.req.headers['x-hub-signature']).to.be.not.exist()
        expect(this.req.headers['link']).to.be.equals(
          `<http://localhost:3000>; rel="hub"; <${topic +
            '/feeds'}>; rel="self"`
        )
        expect(requestBody).to.be.equals(blogFeeds)
        return [200]
      })

    response = await Got.post(`http://localhost:${PORT}/publish`, {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }
    })

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })
})
