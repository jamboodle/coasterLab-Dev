// Single and batch downloads use the same Bambu project/color assignments.
function make3MF(result,template=batchTemplate,name='CoasterLab coaster'){
 return makeBatch3MF([{file:{name},stl:result}],template);
}
