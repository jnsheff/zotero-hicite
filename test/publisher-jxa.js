// The "Include publisher" display option must change the translator output.
ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
eval(read(dir + '/test/run.js'));
var src = read(dir + '/addon/translator/hicite.js');
var items = JSON.parse(read(dir + '/test/sample-items.json'));
var off = runTranslator(src, items, { 'Include publisher': false });
var on = runTranslator(src, items, { 'Include publisher': true });
(off.indexOf('publisher={LexisNexis}') < 0 && on.indexOf('publisher={LexisNexis}') >= 0)
	? 'publisher option OK' : 'FAIL: publisher option has no effect';
