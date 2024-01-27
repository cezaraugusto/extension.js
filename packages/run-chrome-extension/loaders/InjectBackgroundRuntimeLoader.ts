import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    }
  }
}

interface InjectBackgroundAcceptContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (this: InjectBackgroundAcceptContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject Reload (background.scripts and background.service_worker) Script',
    baseDataPath: 'options'
  })

  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
  ;chrome.runtime.onMessageExternal.addListener(
    async (request, _sender, sendResponse) => {
      const managementInfo = await new Promise((resolve) => {
        chrome.management.getSelf(resolve);
      });
 
      // Ping-pong between the user extension background page(this)
      // and the middleware socket client (reloadService.ts),
      // which will then send a message to the server
      // (startServer.ts) so it can display the extension info.
      if (request.initialLoadData) {
        sendResponse({
          id: chrome.runtime.id,
          manifest: chrome.runtime.getManifest(),
          management: managementInfo,
          management2: await chrome.management.getSelf()
        })
        return true
      }
  
      // Reload the extension runtime if the manifest or
      // service worker changes. 
      if (
        request.changedFile === 'manifest.json' ||
        request.changedFile === 'service_worker'
      ) {
        setTimeout(() => {
          sendResponse({reloaded: true})
          chrome.runtime.reload()
        }, 750)
      }

      // if (request.changedFile === 'html') {
      //   sendResponse({reloaded: true})
      //   setTimeout(() => {
      //     chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      //       if (tabs[0]) {
      //         chrome.tabs.reload(tabs[0].id)
      //       }
      //     })
      //   }, 750)
      // }

      // Reload the HTML page if the HTML file changes.
      // TODO: cezaraugusto Sometimes this is not enough.
      // Maybe reloading the tab solves the issue?
      chrome.runtime.onMessageExternal.addListener(
        (request, _sender, sendResponse) => {
          if (request.changedFile === 'html') {
            setTimeout(() => {
              sendResponse({reloaded: true})
              window.location.reload()
            }, 750)
          }
        }
      )

      // Reload all tabs if the contextMenus code changes.
      if (request.changedFile === 'contextMenus') {
        sendResponse({reloaded: true})
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => chrome.tabs.reload(tab.id))
        })
      }

      // Reload all tabs if the declarative_net_request code changes.
      if (request.changedFile === 'declarative_net_request') {
        sendResponse({reloaded: true})
        chrome.runtime.reload()
      }
  
      return true
    }
  );
  `

  // Let the react reload plugin handle the reload.
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of [manifest.background.scripts[0]]) {
        const absoluteUrl = path.resolve(projectPath, bgScript)

        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }

    if (manifest.background.service_worker) {
      const absoluteUrl = path.resolve(
        projectPath,
        manifest.background.service_worker
      )
      if (url.includes(absoluteUrl)) {
        return `${reloadCode}${source}`
      }
    }
  }

  return source
}
