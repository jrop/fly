var fs = require('fs')
var co = require('co')
// var { readFile as read } = require('mz/fs')
var test = require('tape').test
var touch = require('touch')
var Fly = require('../lib/fly')
var join = require('path').join

var fixtures = join(process.cwd(), 'test', 'fixtures')
var flyfile = join(fixtures, 'flyfile.js')

test('✈  fly', function (t) {
	t.ok(Fly !== undefined, 'is defined')

	var methods = [
		'source', 'filter', 'watch', 'unwrap', 'exec',
		'start', 'write', 'clear', 'concat', 'target', 'emit'
	]

	methods.forEach(function (method) {
		t.ok(method !== undefined, method + ' is defined')
	})

	t.end()
})

test('✈  fly.constructor', function (t) {
	var fly = new Fly({
		file: flyfile,
		host: {
			task: function () {
				t.equal(fly, this, 'bind tasks to fly instance')
			}
		}
	})

	t.ok(fly !== undefined, 'create fly instance')

	t.ok(fly.tasks.task !== undefined, 'load task from host')
	fly.tasks.task()

	t.deepEqual(fly.plugins, [], 'no default plugins')

	t.equal(process.cwd(), fixtures, 'switch current working directory')

	t.equal(fly.file, flyfile, 'set file to path specified in the constructor')

	t.end()
})

test('✈  fly.source', function (t) {
	var fly = new Fly()
	fly.source([[[[['*.a', ['*.b']]], ['*.c']]]])
	t.deepEqual(fly._.globs, ['*.a', '*.b', '*.c'], 'flatten globs')
	t.deepEqual(fly._.filters, [], 'init empty filter list')
	t.end()
})

test('✈  fly.filter', function (t) {
	var fly = new Fly()

	fly.filter(function (src) {
		return src.toLowerCase()
	})

	t.equal(fly._.filters.length, 1, 'add filter to filter collection')

	t.equal(fly._.filters[0].cb('FLY'), 'fly', 'add transform cb for anonymous filters')

	fly.filter('myFilter', function (data) {
		return {
			code: data.toString().toUpperCase(),
			ext: '.foo'
		}
	})

	t.ok(fly.myFilter instanceof Function, 'add transform cb to fly instance for named filters')

	fly.myFilter({secret: 42})

	t.equal(fly._.filters[1].cb('fly').code, 'FLY', 'create transform cb function for named filter')
	t.equal(fly._.filters[1].cb('fly').ext, '.foo', 'read extension from filter')
	t.equal(fly._.filters[1].options.secret, 42, 'read options from filter')

	try {
		fly.filter('myFilter')
	} catch (e) {
		t.ok(true, 'throw an error if filter already exists')
	}

	fly.source('')
	t.deepEqual(fly._.filters, [], 'reset filter each time source is called')

	t.end()
})

test('✈  fly.watch', function (t) {
	t.plan(6)
	var glob = 'flyfile.js'
	var file = flyfile

	var fly = new Fly({
		file: file,
		host: {
			default: function * (data) {
				t.ok(true, 'run tasks at least once')
				t.equal(data, 42, 'pass options into task via start')
			}
		}
	})

	fly.emit = function (event) {
		if (event === 'fly_watch') {
			t.ok(true, 'notify watch event to observers')
		}
		return fly
	}

	fly.watch(glob, 'default', {value: 42}).then(function (watcher) {
		t.ok(watcher.unwatch !== undefined, 'watch promise resolves to a watcher')
		setTimeout(function () {
			// hijack the task to test the watcher runs default when the glob changes
			fly.host.default = function * (data) {
				watcher.unwatch(glob)
				t.ok(true, 'run given tasks when glob changes')
				t.equal(data, 42, 'pass options into task via start on change')
			}
			touch(file)
		}, 100)
	})
})

test('✈  fly.unwrap', function (t) {
	t.plan(4)
	var fly = new Fly()

	var xFiles = ['a.x', 'b.x', 'c.x']
	var yFiles = ['a.y', 'b.y', 'c.y']
	var files = xFiles.concat(yFiles)

	files.map(function (file) {
		var f = join(fixtures, file)
		touch(f)
		return f
	})

	co(function * () {
		yield fly.source('*.x').unwrap(function (f) {
			t.deepEqual(f, xFiles, 'unwrap source globs with single entry point')
		})

		yield fly.source(['*.y']).unwrap(function (f) {
			t.deepEqual(f, yFiles, 'unwrap source globs with single entry point in array')
		})

		var result = yield fly.source(['*.x', '*.y']).unwrap(function (f) {
			t.deepEqual(f, files, 'unwrap source globs with multiple entry points')
			return 42
		})

		t.equal(result, 42, 'result is the return value from fulfilled handler')

		yield fly.clear(files)
	})
})

test('✈  fly.*exec', function (t) {
	t.plan(4)

	var fly = new Fly({
		host: {
			task: function * (data) {
				t.ok(true, 'run a task')
				t.equal(data, 'rosebud', 'pass an initial value to task')
			}
		}
	})

	fly.emit = function (event) {
		if (event === 'task_start') {
			t.ok(true, 'notify start event to observers')
		}
		if (event === 'task_complete') {
			t.ok(true, 'notify complete event to observers')
		}
		return fly
	}

	co(fly.exec.bind(fly), 'task', 'rosebud')
})

test('✈  fly.start', function (t) {
	t.plan(3)
	var value = 42
	var fly = new Fly({
		host: {
			a: function * (data) {
				return data + 1
			},
			b: function * (data) {
				return data + 1
			},
			c: function * (data) {
				t.ok(true, 'run a given list of tasks')
				t.equal(data, value + 2, 'cascade return values')
				return data + 1
			}
		}
	})

	co(function * () {
		var result = yield fly.start(['a', 'b', 'c'], {value: value})
		t.equal(result, value + 3, 'return last task value')
	})
})

test('✈  fly.start (order)', function (t, state) {
	t.plan(2)
	state = 0
	var fly = new Fly({
		// when running in a sequence both b and c wait while a blocks.
		// when running in parallel, b and c run while a blocks. state
		// can only be 3 when each task runs in order.
		host: {
			a: function * () {
				yield block()
				if (state === 0) {
					state++
				}
			},
			b: function * () {
				state++
			},
			c: function * () {
				state++
			}
		}
	})

	co(function * () {
		yield fly.start(['a', 'b', 'c'], {parallel: false})
		t.ok(state === 3, 'run tasks in sequence')
		state = 0 // reset
		yield fly.start(['a', 'b', 'c'], {parallel: true})
		t.ok(state !== 3, 'run tasks in parallel')
	})

	function block() {
		return new Promise(function (resolve) {
			return setTimeout(resolve, 200)
		})
	}
})

test('✈  fly.clear', function (t) {
	t.plan(1)
	var paths = ['tmp1', 'tmp2', 'tmp3'].map(function (file) {
		var f = join(fixtures, file)
		touch(f)
		return f
	})

	var fly = new Fly()

	co(function * () {
		yield fly.clear(paths)
		t.ok(true, 'clear files from a given list of paths')
	})
})

test('✈  fly.concat', function (t) {
	var fly = new Fly()
	fly.concat('f')
	t.equal(fly._.cat.base, 'f', 'add concat writer')
	t.end()
})

test('✈  fly.flatten', function (t) {
	t.plan(4)
	var fly = new Fly()

	var src = join(fixtures, '**/*.md')
	var dest = join(fixtures, 'dest')

	var resultsNormal = ['one']
	var resultsZero = ['one.md', 'two-1.md', 'two-2.md']
	var resultsOne = ['one', 'two']

	function * matches(dir, expect) {
		var data = fs.readdirSync(dir)
		return (expect.length === data.length) && expect.every(function (u, i) {
			return u === data[i]
		})
	}

	co(function * () {
		var tar = dest + '-1'

		yield fly.source(src).target(tar)
		t.ok(yield matches(tar, resultsNormal), 'retain normal pathing if desired depth not specified')
		yield fly.clear(tar)
	})

	co(function * () {
		var tar = dest + '-2'

		yield fly.source(src).target(tar, {depth: 0})
		t.ok(yield matches(tar, resultsZero), 'move all files to same directory, no parents')
		yield fly.clear(tar)
	})

	co(function * () {
		var tar = dest + '-3'

		yield fly.source(src).target(tar, {depth: 1})
		t.ok(yield matches(tar, resultsOne), 'keep one parent directory per file')
		yield fly.clear(tar)
	})

	co(function* () {
		var tar = dest + '-4'

		yield fly.source(src).target(tar, {depth: 5})
		t.ok(yield matches(tar, resultsNormal), 'retain full path if desired depth exceeds path depth')
		yield fly.clear(tar)
	})
})

test('✈  fly.target', function (t) {
	t.plan(1)

	co(function * () {
		process.chdir(fixtures)

		var fly = new Fly()

		yield fly.source('*.txt').filter(function (data) {
			return data.toString().toUpperCase()
		}).target('.')

		yield fly.source('*.txt').filter(function (data) {
			t.ok(data.toString() === 'FOO BAR\n', 'resolve source, filters and writers')
			return data.toString().toLowerCase()
		}).target('.')
	})
})
