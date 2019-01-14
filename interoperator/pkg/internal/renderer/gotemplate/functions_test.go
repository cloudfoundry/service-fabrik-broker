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

	complexNum := complex(12, 2)
	invalidObj := map[string]interface{}{"complex": complexNum}
	invalidObjStr, err := marshalJSON(invalidObj)
	g.Expect(invalidObjStr).To(gomega.Equal(""))
	g.Expect(err).To(gomega.HaveOccurred())

	objStr2 := "{\"hello\":\"world\",\"hi\":\"india\"}"
	obj2, _ := unmarshalJSON(objStr2)
	g.Expect(obj2).To(gomega.Equal(map[string]interface{}{
		"hello": "world",
		"hi":    "india",
	}))

	invalidObjStr2 := "{\"hello\":\"world\"\"hi\":\"india\"}"
	invalidObj2, err2 := unmarshalJSON(invalidObjStr2)
	g.Expect(invalidObj2).To(gomega.BeNil())
	g.Expect(err2).To(gomega.HaveOccurred())

	str := `{"hello":"world","hi":"india"}`
	quotedStr := quote(str)
	g.Expect(quotedStr).To(gomega.Equal(`"{\"hello\":\"world\",\"hi\":\"india\"}"`))

	str2 := `{"hello":"world","hi":"india"}`
	quotedStr2 := squote(str2)
	g.Expect(quotedStr2).To(gomega.Equal(`'{"hello":"world","hi":"india"}'`))

	str3 := "helloWorld"
	str3Val := strval(str3)
	g.Expect(str3Val).To(gomega.Equal("helloWorld"))

	int := 10
	intVal := strval(int)
	g.Expect(intVal).To(gomega.Equal("10"))

}
