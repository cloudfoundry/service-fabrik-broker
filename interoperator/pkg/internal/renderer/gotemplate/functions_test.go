package gotemplate

import (
	"testing"

	"github.com/onsi/gomega"
)

func TestGoTemplateFunctions(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	g.Expect(encodeToString("Hello")).To(gomega.Equal("SGVsbG8="))
	g.Expect(decodeString("SGVsbG8=")).To(gomega.Equal("Hello"))

	obj := map[string]interface{}{
		"hello": "world",
		"hi":    "india",
	}
	objStr, _ := marshalJSON(obj)
	g.Expect(objStr).To(gomega.Equal("{\"hello\":\"world\",\"hi\":\"india\"}"))

	objStr2 := "{\"hello\":\"world\",\"hi\":\"india\"}"
	obj2, _ := unmarshalJSON(objStr2)
	g.Expect(obj2).To(gomega.Equal(map[string]interface{}{
		"hello": "world",
		"hi":    "india",
	}))

	str := `{"hello":"world","hi":"india"}`
	quotedStr := quote(str)
	g.Expect(quotedStr).To(gomega.Equal(`"{\"hello\":\"world\",\"hi\":\"india\"}"`))

	str2 := `{"hello":"world","hi":"india"}`
	quotedStr2 := squote(str2)
	g.Expect(quotedStr2).To(gomega.Equal(`'{"hello":"world","hi":"india"}'`))

}
