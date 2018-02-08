var Hapi = require('hapi')
var Inert = require('inert')
var Path = require('path')
var Fs = require('fs')
var Phantom = require('phantomjs-prebuilt')
var ChildProcess = require('child_process')
var PortFinder = require('portfinder')

const pathPlaceholder = '/publicPathPlaceholder/'

module.exports = function (publicPath, staticDir, route, options, callback) {
  function serveAndPrerenderRoute () {
    PortFinder.getPort(function (error, port) {
      if (error) throw error

      var Server = new Hapi.Server({
        connections: {
          routes: {
            files: {
              relativeTo: staticDir
            }
          }
        }
      })

      Server.connection({ port: port })

      Server.register(Inert, function (error) {
        if (error) throw error
        var indexPath = options.indexPath ? options.indexPath : Path.join(staticDir, 'index.html')

        Server.route({
          method: 'GET',
          path: route,
          handler: function (request, reply) {
            if (publicPath === '/') {
              reply.file(indexPath)
              return
            }

            const indexContent = Fs.readFileSync(indexPath, 'utf-8').replace(new RegExp(publicPath, 'gi'), pathPlaceholder)
            reply(indexContent)
          }
        })

        Server.route({
          method: 'GET',
          path: '/{param*}',
          // handler: {
          //   directory: {
          //     path: '.',
          //     redirectToSlash: true,
          //     index: true,
          //     showHidden: true
          //   }
          // }
          handler: function (request, reply) {
            const filePath = request.url.path.replace(pathPlaceholder, '/')
            reply.file(
              Path.join(staticDir, filePath)
            )
          }
        })

        Server.start(function (error) {
          // If port is already bound, try again with another port
          if (error) return serveAndPrerenderRoute()

          var maxAttempts = options.maxAttempts || 5
          var attemptsSoFar = 0

          var phantomArguments = [
            Path.join(__dirname, 'phantom-page-render.js'),
            'http://localhost:' + port + route,
            JSON.stringify(options)
          ]

          if (options.phantomOptions) {
            phantomArguments.unshift(options.phantomOptions)
          }

          function capturePage () {
            attemptsSoFar += 1

            ChildProcess.execFile(
              Phantom.path,
              phantomArguments,
              {maxBuffer: 1048576},
              function (error, stdout, stderr) {
                if (error || stderr) {
                  // Retry if we haven't reached the max number of capture attempts
                  if (attemptsSoFar <= maxAttempts) {
                    return capturePage()
                  } else {
                    if (error) throw error
                    if (stderr) throw stderr
                  }
                }

                if (publicPath === '/') {
                  callback(stdout)
                } else {
                  callback(stdout.replace(new RegExp(pathPlaceholder, 'gi'), publicPath))
                }

                Server.stop()
              }
            )
          }
          capturePage()
        })
      })
    })
  }
  serveAndPrerenderRoute()
}
