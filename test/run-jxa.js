ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
eval(read(dir + '/test/run.js'));
var src = read(dir + '/addon/translator/hicite.js');
var items = JSON.parse(read(dir + '/test/sample-items.json'));
var out = runTranslator(src, items, { 'Include publisher': false }, { maxAuthors: '3' }); // cap 3 so hicite also checks the "et al." syntax
// items with citation-phoenix (Juris-M) data, exported in phoenix mode, so hicite also checks regcode, treaty and the translated courts
out += runTranslator(src, JSON.parse(read(dir + '/test/sample-phoenix-items.json')), {}, { phoenix: 'on' });
$.NSString.alloc.initWithUTF8String(out).writeToFileAtomicallyEncodingError(dir + '/test/out.tex', true, $.NSUTF8StringEncoding, null);
out;
