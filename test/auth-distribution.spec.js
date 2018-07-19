'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Crypto = require('crypto')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')

describe('Authenticated Content Distribution', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'
  let secret = '123456'

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

  it('Should be able to distribute content with secret mechanism', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const secret = '123456789101112'
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
      'hub.topic': topic + '/feeds',
      'hub.secret': secret
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
        expect(this.req.headers['x-hub-signature']).to.be.exist()
        expect(this.req.headers['x-hub-signature']).to.be.equals(
          Crypto.createHmac('sha256', secret)
            .update(JSON.stringify(blogFeeds))
            .digest('hex')
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

  it('Subscriber has verified that the content was manipulated', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const secret = '123456789101112'
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
      'hub.topic': topic + '/feeds',
      'hub.secret': secret
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
        expect(this.req.headers['x-hub-signature']).to.be.exist()
        expect(requestBody).to.be.equals(blogFeeds)

        if (
          Crypto.createHmac('sha256', 'differentSecret')
            .update(JSON.stringify(blogFeeds))
            .digest('hex') !== this.req.headers['x-hub-signature']
        ) {
          return [401, '']
        }
        return [200, '']
      })

    try {
      response = await Got.post(`http://localhost:${PORT}/publish`, {
        form: true,
        body: {
          'hub.mode': 'publish',
          'hub.url': topic + '/feeds'
        }
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(400)
    }

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })
})
