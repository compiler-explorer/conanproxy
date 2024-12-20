
const restricted_compiler_types = ['win32-vc', 'qnx', 'edg'];
const restricted_compiler_id_prefixes = ['icc'];

function is_restricted_compiler(id, type) {
    if (restricted_compiler_types.includes(type)) {
        return true;
    } else {
        for (const prefix of restricted_compiler_id_prefixes) {
            if (id.startsWith(prefix)) {
                return true;
            }
        }
    }

    return false;
}

module.exports = {
    is_restricted_compiler
};
