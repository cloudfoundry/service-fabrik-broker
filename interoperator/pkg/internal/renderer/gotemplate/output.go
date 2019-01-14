package gotemplate

import (
	"bytes"
	"fmt"
)

type gotemplateOutput struct {
	content bytes.Buffer
}

// FileContent returns explicitly the content of the provided <filename>.
func (c *gotemplateOutput) FileContent(filename string) (string, error) {
	if filename == "main" {
		return c.content.String(), nil
	}
	return "", fmt.Errorf("File not found")
}

// ListFiles returns list of file names rendered
func (c *gotemplateOutput) ListFiles() ([]string, error) {
	fileNames := make([]string, 0, 1)
	fileNames = append(fileNames, "main")
	return fileNames, nil
}
