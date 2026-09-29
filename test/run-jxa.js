ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
eval(read(dir + '/test/run.js'));
var src = read(dir + '/addon/translator/hicite.js');
var items = JSON.parse(read(dir + '/test/sample-items.json'));
var out = runTranslator(src, items, { 'Include publisher': false }, { maxAuthors: '3' }); // cap 3 so hicite also checks the "et al." syntax
$.NSString.alloc.initWithUTF8String(out).writeToFileAtomicallyEncodingError(dir + '/test/out.tex', true, $.NSUTF8StringEncoding, null);
out;
